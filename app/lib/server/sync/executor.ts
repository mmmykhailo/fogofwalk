import type { ActivityMeta } from "~shared/api"
import { flattenActivityPaths } from "~shared/activityContract"
import type { ParsedActivity } from "~/types/activities"
import type { SyncState } from "~/lib/storage"
import type {
  LibraryCommand,
  LibraryCommit,
  LibrarySnapshot,
  RemoteChange,
} from "~/lib/activities/libraryEvents"
import { createUuid } from "~/lib/uuid"
import { ApiRequestError } from "../apiClient"
import {
  type SyncOutboxItem,
  type SyncOutboxItemInput,
  type SyncOutboxOperation,
  type SyncRepository,
} from "./repository"
import {
  isCursorIntentReady,
  planActivitySync,
  type LocalActivityMetadata,
  type SyncIntent,
  type SyncPlan,
  type UploadActivityIntent,
} from "./planner"
import { SyncTransportError, type SyncTransport } from "./transport"

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_MAX_PAGES = 10_000
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000
const TOMBSTONE_MEMORY_MS = 7 * 24 * 60 * 60 * 1000

const EMPTY_SYNC_STATE: SyncState = {
  cursor: 0,
  lastSyncAt: 0,
  serverHashes: [],
}

export interface ActivityLibraryPort {
  initialize(): Promise<LibrarySnapshot>
  getSnapshot(): LibrarySnapshot
  dispatch(command: LibraryCommand): Promise<LibraryCommit>
}

export interface SyncExecutorProgress {
  page: number
  done: number
  total: number
  cursor: number
}

export interface SyncExecutorOptions {
  repository: SyncRepository
  library: ActivityLibraryPort
  transport: SyncTransport
  now?: () => number
  random?: () => number
  owner?: string
  leaseMs?: number
  maxPages?: number
  onProgress?: (progress: SyncExecutorProgress) => void
}

export interface SyncEffectFailure {
  intentId: string
  operation: SyncOutboxOperation
  contentHash?: string
  message: string
  retryable: boolean
  retryAt?: number
}

export interface SyncExecutorResult {
  state: SyncState
  pages: number
  downloadedCount: number
  updatedCount: number
  addedActivities: ParsedActivity[]
  deletedIds: string[]
  failures: SyncEffectFailure[]
  cursorHeld: boolean
}

export class SyncExecutorProtocolError extends Error {
  readonly code = "protocol"

  constructor(message: string) {
    super(message)
    this.name = "SyncExecutorProtocolError"
  }
}

class PermanentSyncEffectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PermanentSyncEffectError"
  }
}

type ActivityEffectPayload =
  | {
      kind: "upload"
      intentId: string
      contentHash: string
      activityId: string
      libraryRevision: number
    }
  | {
      kind: "download"
      intentId: string
      contentHash: string
      remote: ActivityMeta
      libraryRevision: number
    }
  | {
      kind: "metadata"
      intentId: string
      contentHash: string
      remote: ActivityMeta
      libraryRevision: number
    }
  | {
      kind: "tombstone"
      intentId: string
      contentHash: string
      deletedAt: number
      libraryRevision: number
    }

interface ExecutedPage {
  completedIntentIds: Set<string>
  completions: { id: string; leaseId: string }[]
  changes: RemoteChange[]
  failures: SyncEffectFailure[]
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function localMetadata(snapshot: LibrarySnapshot): LocalActivityMetadata[] {
  return snapshot.activities.map((activity) => ({
    id: activity.id,
    name: activity.name,
    contentHash: activity.contentHash,
    isPublic: activity.isPublic,
    activityType: activity.activityType,
    startSunPhase: activity.startSunPhase,
  }))
}

function activityFor(
  snapshot: LibrarySnapshot,
  activityId: string | undefined,
  contentHash: string
): ParsedActivity | undefined {
  return snapshot.activities.find(
    (activity) =>
      (activityId !== undefined && activity.id === activityId) ||
      activity.contentHash === contentHash
  )
}

function metadataKey(activity: UploadActivityIntent): string {
  return JSON.stringify([
    activity.activity.id,
    activity.activity.name,
    activity.activity.isPublic,
    activity.activity.activityType ?? null,
    activity.activity.startSunPhase ?? null,
  ])
}

function intentDedupeKey(intent: SyncIntent, libraryRevision: number): string {
  const hash = "contentHash" in intent ? (intent.contentHash ?? "none") : "none"
  let detail = ""
  if (intent.type === "upload") detail = metadataKey(intent)
  if (intent.type === "download") detail = String(intent.remote.updatedAt)
  if (intent.type === "apply-remote-metadata")
    detail = String(intent.remote.updatedAt)
  if (intent.type === "apply-remote-tombstone")
    detail = String(intent.deletedAt)
  return `activity:${intent.type}:${hash}:${libraryRevision}:${detail}`
}

function effectOperation(intent: SyncIntent): SyncOutboxOperation | null {
  switch (intent.type) {
    case "upload":
      return "upload"
    case "download":
      return "download"
    case "apply-remote-metadata":
      return "metadata"
    case "apply-remote-tombstone":
      return "delete"
    default:
      return null
  }
}

function effectPayload(
  intent: SyncIntent,
  libraryRevision: number
): ActivityEffectPayload | null {
  switch (intent.type) {
    case "upload":
      return {
        kind: "upload",
        intentId: intent.intentId,
        contentHash: intent.contentHash,
        activityId: intent.activity.id,
        libraryRevision,
      }
    case "download":
      return {
        kind: "download",
        intentId: intent.intentId,
        contentHash: intent.contentHash,
        remote: clone(intent.remote),
        libraryRevision,
      }
    case "apply-remote-metadata":
      return {
        kind: "metadata",
        intentId: intent.intentId,
        contentHash: intent.contentHash,
        remote: clone(intent.remote),
        libraryRevision,
      }
    case "apply-remote-tombstone":
      return {
        kind: "tombstone",
        intentId: intent.intentId,
        contentHash: intent.contentHash,
        deletedAt: intent.deletedAt,
        libraryRevision,
      }
    default:
      return null
  }
}

function intentFromPayload(payload: unknown): ActivityEffectPayload {
  if (!payload || typeof payload !== "object") {
    throw new PermanentSyncEffectError("The queued sync effect is malformed.")
  }
  const candidate = payload as Partial<ActivityEffectPayload>
  if (
    typeof candidate.kind !== "string" ||
    typeof candidate.intentId !== "string" ||
    typeof candidate.contentHash !== "string"
  ) {
    throw new PermanentSyncEffectError("The queued sync effect is malformed.")
  }
  if (candidate.kind === "upload") {
    if (typeof candidate.activityId !== "string") {
      throw new PermanentSyncEffectError(
        "The queued upload effect is malformed."
      )
    }
    return candidate as ActivityEffectPayload
  }
  if (candidate.kind === "download" || candidate.kind === "metadata") {
    if (!candidate.remote || typeof candidate.remote !== "object") {
      throw new PermanentSyncEffectError(
        "The queued remote effect is malformed."
      )
    }
    return candidate as ActivityEffectPayload
  }
  if (
    candidate.kind === "tombstone" &&
    typeof candidate.deletedAt === "number" &&
    Number.isFinite(candidate.deletedAt)
  ) {
    return candidate as ActivityEffectPayload
  }
  throw new PermanentSyncEffectError("The queued sync effect is malformed.")
}

function isRemoteRequiredIntent(intent: SyncIntent): boolean {
  return (
    intent.type === "download" ||
    intent.type === "apply-remote-metadata" ||
    intent.type === "apply-remote-tombstone"
  )
}

function requiredIntentIds(plan: SyncPlan): Set<string> {
  if (plan.cursor.type === "advance") {
    return new Set(plan.cursor.requiresIntentIds)
  }
  return new Set(
    plan.intents
      .filter(
        (intent) =>
          isRemoteRequiredIntent(intent) ||
          (intent.type === "upload" && intent.requiresCursor)
      )
      .map((intent) => intent.intentId)
  )
}

function intentOperation(
  intentId: string,
  intents: readonly SyncIntent[]
): SyncOutboxOperation {
  const intent = intents.find((candidate) => candidate.intentId === intentId)
  return (
    effectOperation(
      intent ?? { type: "no-op", intentId, reason: "empty-window" }
    ) ?? "metadata"
  )
}

function retryableError(error: unknown): boolean {
  if (error instanceof PermanentSyncEffectError) return false
  if (error instanceof SyncTransportError) return error.retryable
  if (error instanceof ApiRequestError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    )
  }
  return true
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof SyncTransportError || error instanceof ApiRequestError) {
    return error.message
  }
  if (error instanceof PermanentSyncEffectError) return error.message
  return "The sync effect could not be completed."
}

function retryAt(
  error: unknown,
  attempts: number,
  now: number,
  random: () => number
): number | undefined {
  if (!retryableError(error)) return undefined
  const retryAfter =
    error instanceof ApiRequestError ? error.retryAfterMs : null
  const base = Math.min(
    MAX_RETRY_DELAY_MS,
    1_000 * 2 ** Math.max(0, Math.min(attempts - 1, 14))
  )
  const jitterRatio = Math.min(1, Math.max(0, random())) * 0.2
  const delay =
    retryAfter === null
      ? Math.min(MAX_RETRY_DELAY_MS, base + Math.floor(base * jitterRatio))
      : Math.min(MAX_RETRY_DELAY_MS, Math.max(base, retryAfter))
  return now + delay
}

function tombstonesWithinBoundary(
  values: Readonly<Record<string, number>>,
  cursor: number
): Record<string, number> {
  const cutoff = cursor - TOMBSTONE_MEMORY_MS
  return Object.fromEntries(
    Object.entries(values).filter(([, deletedAt]) => deletedAt >= cutoff)
  )
}

function stateAfterPage(
  base: SyncState,
  plan: SyncPlan,
  pageHasMore: boolean,
  completedIntentIds: ReadonlySet<string>,
  deletions: readonly { contentHash: string; deletedAt: number }[],
  now: number
): SyncState {
  const required = requiredIntentIds(plan)
  const requiredFailed = [...required].some(
    (intentId) => !completedIntentIds.has(intentId)
  )
  const serverHashes = new Set(plan.nextState.serverHashes)
  for (const intent of plan.intents) {
    if (intent.type === "upload" && completedIntentIds.has(intent.intentId)) {
      serverHashes.add(intent.contentHash)
    }
  }

  let appliedTombstones = plan.nextState.appliedTombstones
  if (requiredFailed) {
    const safe = new Map(Object.entries(base.appliedTombstones ?? {}))
    if (base.cursor === 0) {
      for (const tombstone of deletions) {
        const current = safe.get(tombstone.contentHash)
        if (current === undefined || tombstone.deletedAt > current) {
          safe.set(tombstone.contentHash, tombstone.deletedAt)
        }
      }
    }
    for (const intent of plan.intents) {
      if (
        intent.type === "apply-remote-tombstone" &&
        completedIntentIds.has(intent.intentId)
      ) {
        safe.set(intent.contentHash, intent.deletedAt)
      }
    }
    appliedTombstones = Object.fromEntries(safe)
  }

  const canAdvance =
    plan.cursor.type === "advance" &&
    !requiredFailed &&
    isCursorIntentReady(plan.cursor, [...completedIntentIds])
  const cursor = canAdvance ? plan.nextState.cursor : base.cursor
  return {
    ...base,
    cursor,
    lastSyncAt: !requiredFailed && !pageHasMore ? now : base.lastSyncAt,
    serverHashes: [...serverHashes].sort(),
    ignoredHashes: [...plan.nextState.ignoredHashes],
    appliedTombstones: tombstonesWithinBoundary(appliedTombstones, cursor),
  }
}

export class ActivitySyncExecutor {
  private readonly now: () => number
  private readonly random: () => number
  private readonly owner: string
  private readonly leaseMs: number
  private readonly maxPages: number
  private readonly onProgress:
    | ((progress: SyncExecutorProgress) => void)
    | undefined

  constructor(private readonly options: SyncExecutorOptions) {
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? Math.random
    this.owner = options.owner ?? `sync-executor:${createUuid()}`
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    this.onProgress = options.onProgress
  }

  async run(): Promise<SyncExecutorResult> {
    await this.options.library.initialize()
    let state =
      (await this.options.repository.loadState()) ?? clone(EMPTY_SYNC_STATE)
    let pages = 0
    let downloadedCount = 0
    let updatedCount = 0
    const addedActivities: ParsedActivity[] = []
    const deletedIds: string[] = []
    const failures: SyncEffectFailure[] = []

    for (;;) {
      if (pages >= this.maxPages) {
        throw new SyncExecutorProtocolError(
          "The activity manifest exceeded the safe page limit."
        )
      }
      const page = await this.options.transport.fetchActivityManifest(
        state.cursor
      )
      const plan = planActivitySync({
        localActivities: localMetadata(this.options.library.getSnapshot()),
        state,
        remote: { ...page, since: state.cursor },
      })
      if (plan.diagnostics.length > 0) {
        throw new SyncExecutorProtocolError(plan.diagnostics[0]!.message)
      }

      const pageResult = await this.executePage(plan)
      const required = requiredIntentIds(plan)
      const requiredFailed = [...required].some(
        (intentId) => !pageResult.completedIntentIds.has(intentId)
      )

      if (pageResult.changes.length > 0) {
        const commit = await this.options.library.dispatch({
          type: "applyRemote",
          operationId: createUuid(),
          changes: pageResult.changes,
        })
        downloadedCount += commit.change.added.length
        updatedCount += commit.change.updated.length
        addedActivities.push(...commit.change.added)
        deletedIds.push(...commit.change.removed.map((activity) => activity.id))
      }

      const nextState = stateAfterPage(
        state,
        plan,
        page.hasMore,
        pageResult.completedIntentIds,
        page.deletions,
        this.now()
      )
      const committed = await this.options.repository.commitStateAndOutbox({
        state: nextState,
        complete: pageResult.completions,
      })
      if (!committed) {
        throw new Error(
          "The sync lease changed before its state was committed."
        )
      }

      pages++
      failures.push(...pageResult.failures)
      this.onProgress?.({
        page: pages,
        done: pageResult.completedIntentIds.size,
        total: plan.intents.filter((intent) => effectOperation(intent) !== null)
          .length,
        cursor: nextState.cursor,
      })
      state = nextState

      if (requiredFailed || !page.hasMore || plan.cursor.type === "hold") {
        return {
          state: clone(state),
          pages,
          downloadedCount,
          updatedCount,
          addedActivities,
          deletedIds,
          failures,
          cursorHeld: requiredFailed,
        }
      }
    }
  }

  private async enqueueEffects(
    plan: SyncPlan,
    libraryRevision: number
  ): Promise<Map<string, SyncOutboxItem>> {
    const existing = new Map(
      (await this.options.repository.loadOutbox()).map((item) => [
        item.dedupeKey,
        item,
      ])
    )
    const items = new Map<string, SyncOutboxItem>()
    for (const intent of plan.intents) {
      const operation = effectOperation(intent)
      const payload = effectPayload(intent, libraryRevision)
      if (!operation || !payload) continue
      const dedupeKey = intentDedupeKey(intent, libraryRevision)
      const current = existing.get(dedupeKey)
      const item =
        current ??
        (await this.options.repository.enqueueOutbox({
          dedupeKey,
          operation,
          payload,
        } satisfies SyncOutboxItemInput))
      items.set(intent.intentId, item)
    }
    return items
  }

  private async executePage(plan: SyncPlan): Promise<ExecutedPage> {
    const libraryRevision = this.options.library.getSnapshot().revision
    const items = await this.enqueueEffects(plan, libraryRevision)
    const completedIntentIds = new Set<string>()
    const completions: { id: string; leaseId: string }[] = []
    const changes: RemoteChange[] = []
    const failures: SyncEffectFailure[] = []
    const effectIntents = plan.intents.filter(
      (intent) => effectOperation(intent) !== null
    )

    for (const intent of effectIntents) {
      const item = items.get(intent.intentId)
      if (!item) continue
      if (item.status === "complete") {
        completedIntentIds.add(intent.intentId)
        continue
      }
      if (item.status === "permanent") {
        failures.push({
          intentId: intent.intentId,
          operation: intentOperation(intent.intentId, plan.intents),
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
          message:
            item.lastFailure?.message ?? "This sync effect was rejected.",
          retryable: false,
        })
        continue
      }
      if (item.status === "in-flight" && (item.leaseUntil ?? 0) > this.now()) {
        failures.push({
          intentId: intent.intentId,
          operation: intentOperation(intent.intentId, plan.intents),
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
          message: "This sync effect is leased by another tab.",
          retryable: true,
          retryAt: item.leaseUntil,
        })
        continue
      }
      if (item.status === "retryable" && item.availableAt > this.now()) {
        failures.push({
          intentId: intent.intentId,
          operation: intentOperation(intent.intentId, plan.intents),
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
          message:
            item.lastFailure?.message ??
            "This sync effect is waiting to retry.",
          retryable: true,
          retryAt: item.availableAt,
        })
        continue
      }

      const [claimed] = await this.options.repository.claimOutbox({
        now: this.now(),
        leaseMs: this.leaseMs,
        owner: this.owner,
        ids: [item.id],
        limit: 1,
      })
      if (!claimed || !claimed.leaseId) {
        failures.push({
          intentId: intent.intentId,
          operation: intentOperation(intent.intentId, plan.intents),
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
          message: "This sync effect could not acquire a lease.",
          retryable: true,
        })
        continue
      }

      try {
        const change = await this.executeEffect(claimed)
        if (change) changes.push(change)
        completedIntentIds.add(intent.intentId)
        completions.push({ id: claimed.id, leaseId: claimed.leaseId })
      } catch (error) {
        const retryable = retryableError(error)
        const failure: SyncEffectFailure = {
          intentId: intent.intentId,
          operation: claimed.operation,
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
          message: safeErrorMessage(error),
          retryable,
          retryAt: retryAt(error, claimed.attempts, this.now(), this.random),
        }
        await this.options.repository.failOutbox(claimed.id, claimed.leaseId, {
          code:
            error instanceof SyncTransportError ||
            error instanceof ApiRequestError
              ? error.code
              : "sync-effect-failed",
          message: failure.message,
          retryable,
          ...(failure.retryAt !== undefined
            ? { retryAt: failure.retryAt }
            : {}),
          ...(error instanceof ApiRequestError ? { status: error.status } : {}),
          failedAt: this.now(),
        })
        failures.push(failure)
      }
    }

    return { completedIntentIds, completions, changes, failures }
  }

  private async executeEffect(
    item: SyncOutboxItem
  ): Promise<RemoteChange | null> {
    const payload = intentFromPayload(item.payload)
    const snapshot = this.options.library.getSnapshot()
    switch (payload.kind) {
      case "upload": {
        const activity = activityFor(
          snapshot,
          payload.activityId,
          payload.contentHash
        )
        if (!activity) return null
        if (activity.contentHash !== payload.contentHash) {
          throw new PermanentSyncEffectError(
            "The queued upload no longer matches the local activity."
          )
        }
        try {
          await this.options.transport.uploadActivity(activity)
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 409)
            return null
          throw error
        }
        return null
      }
      case "download": {
        const result = await this.options.transport.downloadActivity(
          payload.contentHash
        )
        const local = activityFor(snapshot, undefined, payload.contentHash)
        const coordinates =
          result.payload.coordinates ??
          flattenActivityPaths(result.payload.paths ?? [])
        const activity: ParsedActivity = {
          ...result.payload,
          coordinates,
          id: local?.id ?? createUuid(),
          contentHash: payload.contentHash,
          name: payload.remote.name,
          isPublic: payload.remote.isPublic,
          activityType:
            payload.remote.activityType ?? result.payload.activityType,
          startSunPhase:
            payload.remote.startSunPhase ?? result.payload.startSunPhase,
        }
        return { type: "upsert", activity }
      }
      case "metadata": {
        const local = activityFor(snapshot, undefined, payload.contentHash)
        if (!local) return null
        return {
          type: "upsert",
          activity: {
            ...local,
            name: payload.remote.name,
            isPublic: payload.remote.isPublic,
            activityType: payload.remote.activityType,
            startSunPhase: payload.remote.startSunPhase,
          },
        }
      }
      case "tombstone":
        return {
          type: "delete",
          contentHash: payload.contentHash,
          deletedAt: payload.deletedAt,
        }
    }
  }
}
