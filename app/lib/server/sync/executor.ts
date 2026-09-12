import type { ActivityMeta, ActivityMetadataUpdate } from "~shared/api"
import { flattenActivityPaths } from "~shared/activityContract"
import type { ParsedActivity } from "~/types/activities"
import type { SyncState } from "~/lib/storage"
import type {
  ActivityMetadataPatch,
  LibraryCommand,
  LibraryCommit,
  LibrarySnapshot,
  RemoteChange,
} from "~/lib/activities/libraryEvents"
import { createUuid } from "~/lib/uuid"
import { isApiRequestError } from "../apiClient"
import {
  type SyncOutboxItem,
  type SyncOutboxItemInput,
  type SyncOutboxOperation,
  type SyncRepository,
} from "./repository"
import {
  hasLocalActivityEffectSource,
  type LocalActivityDeletePayload,
  type LocalActivityMetadataPayload,
  type LocalActivityUploadPayload,
} from "./activityEffects"
import {
  isCursorIntentReady,
  planActivitySync,
  type LocalActivityMetadata,
  type SyncIntent,
  type SyncPlan,
  type UploadActivityIntent,
} from "./planner"
import { isSyncTransportError, type SyncTransport } from "./transport"
import { isSyncCancellationError, throwIfSyncAborted } from "./cancellation"

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
  /** Local hashes already owned by another account on this device. */
  excludedLocalHashes?: readonly string[]
  now?: () => number
  random?: () => number
  owner?: string
  leaseMs?: number
  maxPages?: number
  signal?: AbortSignal
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

export type SyncExecutorProtocolError = Error & {
  readonly name: "SyncExecutorProtocolError"
  readonly code: "protocol"
}

export function createSyncExecutorProtocolError(
  message: string
): SyncExecutorProtocolError {
  const error = new Error(message) as SyncExecutorProtocolError
  Object.assign(error, { name: "SyncExecutorProtocolError", code: "protocol" })
  return error
}

export function isSyncExecutorProtocolError(
  error: unknown
): error is SyncExecutorProtocolError {
  return (
    error instanceof Error &&
    error.name === "SyncExecutorProtocolError" &&
    (error as Partial<SyncExecutorProtocolError>).code === "protocol"
  )
}

type PermanentSyncEffectError = Error & {
  readonly name: "PermanentSyncEffectError"
}

function createPermanentSyncEffectError(
  message: string
): PermanentSyncEffectError {
  const error = new Error(message) as PermanentSyncEffectError
  error.name = "PermanentSyncEffectError"
  return error
}

function isPermanentSyncEffectError(
  error: unknown
): error is PermanentSyncEffectError {
  return error instanceof Error && error.name === "PermanentSyncEffectError"
}

type ActivityEffectPayload =
  | {
      kind: "upload"
      source?: "local"
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
      localId?: string
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
  | LocalActivityDeletePayload
  | LocalActivityMetadataPayload

interface ExecutedPage {
  completedIntentIds: Set<string>
  completions: { id: string; leaseId: string }[]
  changes: RemoteChange[]
  appliedTombstones: { contentHash: string; deletedAt: number }[]
  addedServerHashes: string[]
  removedServerHashes: string[]
  metadataPatches: ActivityMetadataPatch[]
  failures: SyncEffectFailure[]
}

interface EffectExecution {
  change: RemoteChange | null
  metadataPatch?: ActivityMetadataPatch
  appliedTombstone?: { contentHash: string; deletedAt: number }
  addedServerHash?: string
  removedServerHash?: string
}

interface EffectWork {
  item: SyncOutboxItem
  intentId: string
  operation: SyncOutboxOperation
  contentHash?: string
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function localMetadata(
  snapshot: LibrarySnapshot,
  excludedHashes: ReadonlySet<string> = new Set()
): LocalActivityMetadata[] {
  return snapshot.activities
    .filter(
      (activity) =>
        !activity.contentHash || !excludedHashes.has(activity.contentHash)
    )
    .map((activity) => ({
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
        localId: intent.localId,
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
    throw createPermanentSyncEffectError("The queued sync effect is malformed.")
  }
  const candidate = payload as Partial<ActivityEffectPayload>
  if (
    typeof candidate.kind !== "string" ||
    typeof candidate.intentId !== "string" ||
    typeof candidate.contentHash !== "string"
  ) {
    throw createPermanentSyncEffectError("The queued sync effect is malformed.")
  }
  if (candidate.kind === "upload") {
    if (typeof candidate.activityId !== "string") {
      throw createPermanentSyncEffectError(
        "The queued upload effect is malformed."
      )
    }
    if (candidate.source !== undefined && candidate.source !== "local") {
      throw createPermanentSyncEffectError(
        "The queued upload effect has an invalid source."
      )
    }
    return candidate as ActivityEffectPayload
  }
  if (candidate.kind === "download" || candidate.kind === "metadata") {
    if (!candidate.remote || typeof candidate.remote !== "object") {
      throw createPermanentSyncEffectError(
        "The queued remote effect is malformed."
      )
    }
    if (
      candidate.kind === "metadata" &&
      candidate.localId !== undefined &&
      typeof candidate.localId !== "string"
    ) {
      throw createPermanentSyncEffectError(
        "The queued remote metadata effect has an invalid local id."
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
  if (candidate.kind === "local-delete") {
    if (
      candidate.source !== "local" ||
      typeof candidate.intentId !== "string" ||
      typeof candidate.contentHash !== "string"
    ) {
      throw createPermanentSyncEffectError(
        "The queued local deletion effect is malformed."
      )
    }
    return candidate as ActivityEffectPayload
  }
  if (candidate.kind === "local-metadata") {
    if (
      candidate.source !== "local" ||
      typeof candidate.activityId !== "string" ||
      !isLocalMetadataPatch(candidate.patch)
    ) {
      throw createPermanentSyncEffectError(
        "The queued local metadata effect is malformed."
      )
    }
    return candidate as ActivityEffectPayload
  }
  throw createPermanentSyncEffectError("The queued sync effect is malformed.")
}

function isLocalMetadataPatch(
  value: unknown
): value is LocalActivityMetadataPayload["patch"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  const allowed = new Set(["name", "isPublic", "activityType", "startSunPhase"])
  const keys = Object.keys(candidate)
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) return false
  return keys.every((key) => {
    const entry = candidate[key]
    if (key === "name") return typeof entry === "string" && entry.length > 0
    if (key === "isPublic") return typeof entry === "boolean"
    if (key === "activityType") {
      return (
        entry === null ||
        entry === "walking" ||
        entry === "running" ||
        entry === "cycling" ||
        entry === "kayaking" ||
        entry === "swimming" ||
        entry === "other"
      )
    }
    return (
      entry === null ||
      entry === "before_sunrise" ||
      entry === "daylight" ||
      entry === "after_sunset" ||
      entry === "unknown"
    )
  })
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
  if (isPermanentSyncEffectError(error)) return false
  if (isSyncTransportError(error)) return error.retryable
  if (isApiRequestError(error)) {
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
  if (isSyncTransportError(error) || isApiRequestError(error)) {
    return error.message
  }
  if (isPermanentSyncEffectError(error)) return error.message
  return "The sync effect could not be completed."
}

function retryAt(
  error: unknown,
  attempts: number,
  now: number,
  random: () => number
): number | undefined {
  if (!retryableError(error)) return undefined
  const retryAfter = isApiRequestError(error) ? error.retryAfterMs : null
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

function applyEffectState(
  base: SyncState,
  result: Pick<
    ExecutedPage,
    "addedServerHashes" | "removedServerHashes" | "appliedTombstones"
  >
): SyncState {
  const serverHashes = new Set(base.serverHashes)
  for (const hash of result.removedServerHashes) serverHashes.delete(hash)
  for (const hash of result.addedServerHashes) serverHashes.add(hash)

  const appliedTombstones = new Map(
    Object.entries(base.appliedTombstones ?? {})
  )
  for (const tombstone of result.appliedTombstones) {
    const current = appliedTombstones.get(tombstone.contentHash)
    if (current === undefined || tombstone.deletedAt > current) {
      appliedTombstones.set(tombstone.contentHash, tombstone.deletedAt)
    }
  }

  return {
    ...base,
    serverHashes: [...serverHashes].sort(),
    appliedTombstones: tombstonesWithinBoundary(
      Object.fromEntries(appliedTombstones),
      base.cursor
    ),
  }
}

export interface ActivitySyncExecutor {
  run(): Promise<SyncExecutorResult>
}

export function createActivitySyncExecutor(
  options: SyncExecutorOptions
): ActivitySyncExecutor {
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? Math.random
  const owner = options.owner ?? `sync-executor:${createUuid()}`
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const onProgress = options.onProgress
  const signal = options.signal
  const excludedLocalHashes = new Set(options.excludedLocalHashes ?? [])

  async function run(): Promise<SyncExecutorResult> {
    throwIfSyncAborted(signal)
    await options.library.initialize()
    throwIfSyncAborted(signal)
    let state =
      (await options.repository.loadState()) ?? clone(EMPTY_SYNC_STATE)
    throwIfSyncAborted(signal)
    let pages = 0
    let downloadedCount = 0
    let updatedCount = 0
    const addedActivities: ParsedActivity[] = []
    const deletedIds: string[] = []
    const failures: SyncEffectFailure[] = []

    const localResult = await executeLocalOutbox()
    throwIfSyncAborted(signal)
    if (
      localResult.completions.length > 0 ||
      localResult.appliedTombstones.length > 0 ||
      localResult.addedServerHashes.length > 0 ||
      localResult.removedServerHashes.length > 0
    ) {
      const committed = await options.repository.commitStateAndOutbox({
        state: applyEffectState(state, localResult),
        complete: localResult.completions,
      })
      throwIfSyncAborted(signal)
      if (!committed) {
        throw new Error(
          "The sync lease changed before local effects were committed."
        )
      }
      state = applyEffectState(state, localResult)
    }
    failures.push(...localResult.failures)

    for (;;) {
      throwIfSyncAborted(signal)
      if (pages >= maxPages) {
        throw createSyncExecutorProtocolError(
          "The activity manifest exceeded the safe page limit."
        )
      }
      const page = await options.transport.fetchActivityManifest(
        state.cursor,
        signal
      )
      throwIfSyncAborted(signal)
      const plan = planActivitySync({
        localActivities: localMetadata(
          options.library.getSnapshot(),
          excludedLocalHashes
        ),
        state,
        remote: { ...page, since: state.cursor },
      })
      if (plan.diagnostics.length > 0) {
        throw createSyncExecutorProtocolError(plan.diagnostics[0]!.message)
      }

      const pageResult = await executePage(
        plan,
        new Set(localResult.addedServerHashes)
      )
      throwIfSyncAborted(signal)
      const required = requiredIntentIds(plan)
      const requiredFailed = [...required].some(
        (intentId) => !pageResult.completedIntentIds.has(intentId)
      )

      if (pageResult.changes.length > 0) {
        throwIfSyncAborted(signal)
        const commit = await options.library.dispatch({
          type: "applyRemote",
          operationId: createUuid(),
          changes: pageResult.changes,
        })
        throwIfSyncAborted(signal)
        downloadedCount += commit.change.added.length
        updatedCount += commit.change.updated.length
        addedActivities.push(...commit.change.added)
        deletedIds.push(...commit.change.removed.map((activity) => activity.id))
      }
      if (pageResult.metadataPatches.length > 0) {
        throwIfSyncAborted(signal)
        const commit = await options.library.dispatch({
          type: "updateMetadata",
          operationId: createUuid(),
          patches: pageResult.metadataPatches,
        })
        throwIfSyncAborted(signal)
        updatedCount += commit.change.updated.length
      }

      const nextState = stateAfterPage(
        state,
        plan,
        page.hasMore,
        pageResult.completedIntentIds,
        page.deletions,
        now()
      )
      const stateWithEffects = applyEffectState(nextState, pageResult)
      const committed = await options.repository.commitStateAndOutbox({
        state: stateWithEffects,
        complete: pageResult.completions,
      })
      throwIfSyncAborted(signal)
      if (!committed) {
        throw new Error(
          "The sync lease changed before its state was committed."
        )
      }

      pages++
      failures.push(...pageResult.failures)
      onProgress?.({
        page: pages,
        done: pageResult.completedIntentIds.size,
        total: plan.intents.filter((intent) => effectOperation(intent) !== null)
          .length,
        cursor: stateWithEffects.cursor,
      })
      state = stateWithEffects

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

  async function enqueueEffects(
    plan: SyncPlan,
    libraryRevision: number,
    alreadyUploaded: ReadonlySet<string> = new Set()
  ): Promise<Map<string, SyncOutboxItem>> {
    throwIfSyncAborted(signal)
    const existing = new Map(
      (await options.repository.loadOutbox()).map((item) => [
        item.dedupeKey,
        item,
      ])
    )
    const items = new Map<string, SyncOutboxItem>()
    for (const intent of plan.intents) {
      throwIfSyncAborted(signal)
      if (intent.type === "upload" && alreadyUploaded.has(intent.contentHash)) {
        continue
      }
      const operation = effectOperation(intent)
      const payload = effectPayload(intent, libraryRevision)
      if (!operation || !payload) continue
      const dedupeKey = intentDedupeKey(intent, libraryRevision)
      const current = existing.get(dedupeKey)
      const item =
        current ??
        (await options.repository.enqueueOutbox({
          dedupeKey,
          operation,
          payload,
        } satisfies SyncOutboxItemInput))
      throwIfSyncAborted(signal)
      items.set(intent.intentId, item)
    }
    return items
  }

  async function executePage(
    plan: SyncPlan,
    alreadyUploaded: ReadonlySet<string> = new Set()
  ): Promise<ExecutedPage> {
    throwIfSyncAborted(signal)
    const libraryRevision = options.library.getSnapshot().revision
    const items = await enqueueEffects(plan, libraryRevision, alreadyUploaded)
    const effectIntents = plan.intents.filter(
      (intent) => effectOperation(intent) !== null
    )
    const work: EffectWork[] = []
    const completedWithoutWork: string[] = []
    for (const intent of effectIntents) {
      throwIfSyncAborted(signal)
      const item = items.get(intent.intentId)
      const operation = effectOperation(intent)
      if (intent.type === "upload" && alreadyUploaded.has(intent.contentHash)) {
        completedWithoutWork.push(intent.intentId)
        continue
      }
      if (item && operation) {
        work.push({
          item,
          intentId: intent.intentId,
          operation,
          contentHash: "contentHash" in intent ? intent.contentHash : undefined,
        })
      }
    }
    return executeEffects(work, completedWithoutWork)
  }

  async function executeLocalOutbox(): Promise<ExecutedPage> {
    throwIfSyncAborted(signal)
    const work: EffectWork[] = []
    for (const item of await options.repository.loadOutbox()) {
      throwIfSyncAborted(signal)
      if (!hasLocalActivityEffectSource(item.payload)) continue
      const payload = item.payload as Partial<
        | LocalActivityUploadPayload
        | LocalActivityDeletePayload
        | LocalActivityMetadataPayload
      >
      work.push({
        item,
        intentId:
          typeof payload.intentId === "string" ? payload.intentId : item.id,
        operation: item.operation,
        contentHash:
          typeof payload.contentHash === "string"
            ? payload.contentHash
            : undefined,
      })
    }
    return executeEffects(work)
  }

  async function executeEffects(
    work: readonly EffectWork[],
    completedWithoutWork: readonly string[] = []
  ): Promise<ExecutedPage> {
    throwIfSyncAborted(signal)
    const completedIntentIds = new Set(completedWithoutWork)
    const completions: { id: string; leaseId: string }[] = []
    const changes: RemoteChange[] = []
    const appliedTombstones: { contentHash: string; deletedAt: number }[] = []
    const addedServerHashes: string[] = []
    const removedServerHashes: string[] = []
    const metadataPatches: ActivityMetadataPatch[] = []
    const failures: SyncEffectFailure[] = []

    for (const entry of work) {
      throwIfSyncAborted(signal)
      const { item, intentId, operation, contentHash } = entry
      if (item.status === "complete") {
        completedIntentIds.add(intentId)
        continue
      }
      if (item.status === "permanent") {
        failures.push({
          intentId,
          operation,
          contentHash,
          message:
            item.lastFailure?.message ?? "This sync effect was rejected.",
          retryable: false,
        })
        continue
      }
      if (item.status === "in-flight" && (item.leaseUntil ?? 0) > now()) {
        failures.push({
          intentId,
          operation,
          contentHash,
          message: "This sync effect is leased by another tab.",
          retryable: true,
          retryAt: item.leaseUntil,
        })
        continue
      }
      if (item.status === "retryable" && item.availableAt > now()) {
        failures.push({
          intentId,
          operation,
          contentHash,
          message:
            item.lastFailure?.message ??
            "This sync effect is waiting to retry.",
          retryable: true,
          retryAt: item.availableAt,
        })
        continue
      }

      const [claimed] = await options.repository.claimOutbox({
        now: now(),
        leaseMs,
        owner,
        ids: [item.id],
        limit: 1,
      })
      if (!claimed || !claimed.leaseId) {
        failures.push({
          intentId,
          operation,
          contentHash,
          message: "This sync effect could not acquire a lease.",
          retryable: true,
        })
        continue
      }

      try {
        const result = await executeEffect(claimed)
        throwIfSyncAborted(signal)
        if (result.change) changes.push(result.change)
        if (result.metadataPatch) metadataPatches.push(result.metadataPatch)
        if (result.appliedTombstone)
          appliedTombstones.push(result.appliedTombstone)
        if (result.addedServerHash)
          addedServerHashes.push(result.addedServerHash)
        if (result.removedServerHash)
          removedServerHashes.push(result.removedServerHash)
        completedIntentIds.add(intentId)
        completions.push({ id: claimed.id, leaseId: claimed.leaseId })
      } catch (error) {
        if (signal?.aborted || isSyncCancellationError(error)) {
          throwIfSyncAborted(signal)
          throw error
        }
        const retryable = retryableError(error)
        const failure: SyncEffectFailure = {
          intentId,
          operation: claimed.operation,
          contentHash,
          message: safeErrorMessage(error),
          retryable,
          retryAt: retryAt(error, claimed.attempts, now(), random),
        }
        await options.repository.failOutbox(claimed.id, claimed.leaseId, {
          code:
            isSyncTransportError(error) || isApiRequestError(error)
              ? error.code
              : "sync-effect-failed",
          message: failure.message,
          retryable,
          ...(failure.retryAt !== undefined
            ? { retryAt: failure.retryAt }
            : {}),
          ...(isApiRequestError(error) ? { status: error.status } : {}),
          failedAt: now(),
        })
        failures.push(failure)
      }
    }

    return {
      completedIntentIds,
      completions,
      changes,
      appliedTombstones,
      addedServerHashes,
      removedServerHashes,
      metadataPatches,
      failures,
    }
  }

  async function executeEffect(item: SyncOutboxItem): Promise<EffectExecution> {
    throwIfSyncAborted(signal)
    const payload = intentFromPayload(item.payload)
    switch (payload.kind) {
      case "upload": {
        const snapshot = options.library.getSnapshot()
        const activity = activityFor(
          snapshot,
          payload.activityId,
          payload.contentHash
        )
        if (!activity) return { change: null }
        if (activity.contentHash !== payload.contentHash) {
          throw createPermanentSyncEffectError(
            "The queued upload no longer matches the local activity."
          )
        }
        try {
          await options.transport.uploadActivity(activity, signal)
        } catch (error) {
          if (isApiRequestError(error) && error.status === 409) {
            return {
              change: null,
              addedServerHash: payload.contentHash,
            }
          }
          throw error
        }
        return { change: null, addedServerHash: payload.contentHash }
      }
      case "download": {
        const snapshot = options.library.getSnapshot()
        const result = await options.transport.downloadActivity(
          payload.contentHash,
          signal
        )
        throwIfSyncAborted(signal)
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
        return { change: { type: "upsert", activity } }
      }
      case "metadata": {
        const snapshot = options.library.getSnapshot()
        const local = activityFor(
          snapshot,
          payload.localId,
          payload.contentHash
        )
        if (!local) return { change: null }
        return {
          change: null,
          metadataPatch: {
            id: local.id,
            name: payload.remote.name,
            isPublic: payload.remote.isPublic,
            activityType: payload.remote.activityType ?? null,
            startSunPhase: payload.remote.startSunPhase ?? null,
          },
        }
      }
      case "local-metadata": {
        const updates: ActivityMetadataUpdate[] = [
          {
            contentHash: payload.contentHash,
            ...payload.patch,
          },
        ]
        await options.transport.updateActivityMetadata(updates, signal)
        throwIfSyncAborted(signal)
        return { change: null }
      }
      case "tombstone":
        return {
          change: {
            type: "delete",
            contentHash: payload.contentHash,
            deletedAt: payload.deletedAt,
          },
        }
      case "local-delete": {
        const deletedAt = await options.transport.deleteActivity(
          payload.contentHash,
          signal
        )
        throwIfSyncAborted(signal)
        return {
          change: null,
          appliedTombstone: {
            contentHash: payload.contentHash,
            deletedAt,
          },
          removedServerHash: payload.contentHash,
        }
      }
    }
  }

  return { run }
}
