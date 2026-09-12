import type { ParsedActivity } from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"
import {
  activityToSummary,
  isActivitySummary,
  loadActivitySummaries,
  migrateStoredActivity,
  openStorageDatabase,
  type StoredActivity,
} from "~/lib/storage"
import {
  mergeSyncOutboxItem,
  normaliseSyncOutboxItem,
  type SyncOutboxItem,
  type SyncOutboxItemInput,
} from "~/lib/server/sync/repository"
import {
  createActivityLibraryConflictError,
  createActivityStorageError,
  isActivityLibraryConflictError,
  toActivityStorageError,
} from "./errors"
import type {
  ActivityMetadataPatch,
  DuplicateReason,
  LibraryChange,
  LibraryChangeDomains,
  LibraryCommand,
  LibraryCommit,
  LibraryMetadataCommit,
  LibrarySummarySnapshot,
  LibraryRevision,
  LibrarySnapshot,
  RemoteChange,
} from "./libraryEvents"

export const LIBRARY_SCHEMA_VERSION = 2
export const LIBRARY_META_KEY = "library"

interface StoredLibraryMeta {
  key: typeof LIBRARY_META_KEY
  schemaVersion: number
  revision: LibraryRevision
  coverageRevision: LibraryRevision
}

export interface ActivityLibraryRepository {
  load(): Promise<LibrarySnapshot>
  loadSummarySnapshot(): Promise<LibrarySummarySnapshot>
  commit(
    command: LibraryCommand,
    expectedRevision: number,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryCommit>
  commitMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    expectedRevision: number,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryMetadataCommit>
}

/** Durable effects that must be committed with a canonical library mutation. */
export interface ActivityLibraryCommitOptions {
  /**
   * A factory is evaluated after the command has produced its authoritative
   * LibraryChange. The array form remains for generic repository adapters, but
   * activity effects are filtered against the actual mutation below.
   */
  outbox?:
    | readonly SyncOutboxItemInput[]
    | ((commit: LibraryCommit) => readonly SyncOutboxItemInput[])
  /** A targeted metadata mutation can enqueue its compact effect atomically. */
  metadataOutbox?: (
    commit: LibraryMetadataCommit
  ) => readonly SyncOutboxItemInput[]
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function immutableSnapshot(
  revision: LibraryRevision,
  coverageRevision: LibraryRevision,
  activities: ParsedActivity[]
): LibrarySnapshot {
  // Clone before freezing so callers cannot mutate repository-owned records.
  const records = clone(activities)
  return {
    revision,
    coverageRevision,
    activities: Object.freeze(
      records.map((activity) => Object.freeze(activity))
    ),
  }
}

function findByHash(activities: ParsedActivity[], contentHash: string) {
  return activities.findIndex(
    (activity) => activity.contentHash === contentHash
  )
}

function findById(activities: ParsedActivity[], activityId: string) {
  return activities.findIndex((activity) => activity.id === activityId)
}

function sameActivity(first: ParsedActivity, second: ParsedActivity): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function overlayActivitySummaries(
  activities: StoredActivity[],
  summaries: ActivitySummary[]
): ParsedActivity[] {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]))
  return activities.map((storedActivity) => {
    const activity = migrateStoredActivity(storedActivity)
    const summary = byId.get(activity.id)
    if (!summary) return activity
    return {
      ...activity,
      name: summary.name,
      startedAtMs: summary.startedAtMs,
      activityType: summary.activityType,
      startSunPhase: summary.startSunPhase,
      contentHash: summary.contentHash,
      isPublic: summary.isPublic ?? false,
    }
  })
}

function outboxInputs(
  options: ActivityLibraryCommitOptions,
  commit: LibraryCommit
): readonly SyncOutboxItemInput[] {
  if (!options.outbox) return []
  const inputs =
    typeof options.outbox === "function"
      ? options.outbox(commit)
      : options.outbox
  return inputs
    .filter((input) => effectMatchesChange(input, commit.change))
    .map((input) => withCommittedRevision(input, commit.snapshot.revision))
}

function metadataOutboxInputs(
  options: ActivityLibraryCommitOptions,
  commit: LibraryMetadataCommit
): readonly SyncOutboxItemInput[] {
  if (!options.metadataOutbox || commit.updated.length === 0) return []
  return options
    .metadataOutbox(commit)
    .map((input) => withCommittedRevision(input, commit.revision))
}

function effectMatchesChange(
  input: SyncOutboxItemInput,
  change: LibraryChange
): boolean {
  const payload = input.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    // Non-activity effects are left to their owning adapter. Local activity
    // effects always carry an identity and take the stricter path below.
    return true
  }
  const candidate = payload as {
    source?: unknown
    activityId?: unknown
    contentHash?: unknown
  }
  const isActivityEffect =
    candidate.source === "local" ||
    typeof candidate.activityId === "string" ||
    typeof candidate.contentHash === "string"
  if (!isActivityEffect) return true

  const records =
    input.operation === "delete"
      ? change.removed
      : [...change.added, ...change.updated]
  if (records.length === 0) return false
  return records.some(
    (activity) =>
      (typeof candidate.activityId === "string" &&
        candidate.activityId === activity.id) ||
      (typeof candidate.contentHash === "string" &&
        candidate.contentHash === activity.contentHash)
  )
}

function withCommittedRevision(
  input: SyncOutboxItemInput,
  libraryRevision: number
): SyncOutboxItemInput {
  if (!input.payload || typeof input.payload !== "object") return input
  const payload = input.payload as Record<string, unknown>
  if (!("libraryRevision" in payload)) return input
  return {
    ...input,
    payload: { ...payload, libraryRevision },
  }
}

function duplicate(
  activity: ParsedActivity,
  reason: DuplicateReason["reason"],
  existingActivityId?: string
): DuplicateReason {
  return {
    activityId: activity.id,
    ...(activity.contentHash ? { contentHash: activity.contentHash } : {}),
    ...(existingActivityId ? { existingActivityId } : {}),
    reason,
  }
}

function applyImport(
  activities: ParsedActivity[],
  incoming: ParsedActivity[],
  duplicates: DuplicateReason[]
): ParsedActivity[] {
  const byHash = new Map<string, string>()
  const byId = new Map<string, string>()
  for (const activity of activities) {
    byId.set(activity.id, activity.id)
    if (activity.contentHash) byHash.set(activity.contentHash, activity.id)
  }

  for (const activity of incoming) {
    const existingById = byId.get(activity.id)
    if (existingById) {
      duplicates.push(duplicate(activity, "activity-id", existingById))
      continue
    }
    const existingByHash = activity.contentHash
      ? byHash.get(activity.contentHash)
      : undefined
    if (existingByHash) {
      duplicates.push(duplicate(activity, "content-hash", existingByHash))
      continue
    }
    const record = clone(activity)
    activities.push(record)
    byId.set(record.id, record.id)
    if (record.contentHash) byHash.set(record.contentHash, record.id)
  }
  return activities
}

function applyRemote(
  activities: ParsedActivity[],
  changes: RemoteChange[],
  added: ParsedActivity[],
  updated: ParsedActivity[],
  removed: ParsedActivity[],
  duplicates: DuplicateReason[],
  domains: LibraryChangeDomains
): ParsedActivity[] {
  for (const change of changes) {
    if (change.type === "delete") {
      const index = findByHash(activities, change.contentHash)
      if (index >= 0) {
        removed.push(...activities.splice(index, 1))
        domains.membership = true
        domains.geometry = true
      }
      continue
    }

    const incoming = clone(change.activity)
    const indexByHash = incoming.contentHash
      ? findByHash(activities, incoming.contentHash)
      : -1
    const index =
      indexByHash >= 0 ? indexByHash : findById(activities, incoming.id)
    if (index >= 0) {
      const current = activities[index]!
      // The content hash is the geometry identity. Remote metadata may update
      // the local projection, but the device-local id and local-only fields are
      // retained unless the remote record explicitly carries them.
      const merged = {
        ...current,
        ...incoming,
        id: current.id,
      }
      if (!sameActivity(current, merged)) {
        activities[index] = merged
        updated.push(clone(merged))
        if (
          current.contentHash &&
          incoming.contentHash &&
          current.contentHash === incoming.contentHash
        ) {
          domains.metadata = true
        } else {
          domains.geometry = true
        }
      }
      continue
    }

    if (activities.some((activity) => activity.id === incoming.id)) {
      duplicates.push(duplicate(incoming, "remote-content-hash"))
      continue
    }
    activities.push(incoming)
    added.push(clone(incoming))
    domains.membership = true
    domains.geometry = true
  }
  return activities
}

function metadataPatchValueIsValid(
  patch: ActivityMetadataPatch,
  key: keyof ActivityMetadataPatch
): boolean {
  if (!(key in patch)) return true
  const value = patch[key]
  if (key === "name") return typeof value === "string"
  if (key === "isPublic") return typeof value === "boolean"
  if (key === "activityType") {
    return (
      value === null ||
      value === "walking" ||
      value === "running" ||
      value === "cycling" ||
      value === "kayaking" ||
      value === "swimming" ||
      value === "other"
    )
  }
  return (
    value === null ||
    value === "before_sunrise" ||
    value === "daylight" ||
    value === "after_sunset" ||
    value === "unknown"
  )
}

export function assertValidActivityMetadataPatches(
  patches: readonly ActivityMetadataPatch[]
): void {
  if (patches.length === 0) {
    throw new Error("At least one activity metadata patch is required.")
  }
  const ids = new Set<string>()
  for (const patch of patches) {
    if (
      !patch ||
      typeof patch.id !== "string" ||
      patch.id.length === 0 ||
      ids.has(patch.id)
    ) {
      throw new Error("Activity metadata patches must have unique IDs.")
    }
    ids.add(patch.id)
    const keys = Object.keys(patch).filter((key) => key !== "id")
    if (
      keys.length === 0 ||
      keys.some(
        (key) =>
          key !== "name" &&
          key !== "isPublic" &&
          key !== "activityType" &&
          key !== "startSunPhase"
      )
    ) {
      throw new Error("Activity metadata patches contain an unsupported field.")
    }
    for (const key of [
      "name",
      "isPublic",
      "activityType",
      "startSunPhase",
    ] as const) {
      if (!metadataPatchValueIsValid(patch, key)) {
        throw new Error("Activity metadata patches contain an invalid value.")
      }
    }
  }
}

function applyMetadata(
  activities: ParsedActivity[],
  patches: readonly ActivityMetadataPatch[],
  updated: ParsedActivity[]
): void {
  assertValidActivityMetadataPatches(patches)
  for (const patch of patches) {
    const index = findById(activities, patch.id)
    if (index < 0) continue
    const current = activities[index]!
    let next: ParsedActivity | null = null
    if (patch.name !== undefined && patch.name !== current.name) {
      next = { ...(next ?? current), name: patch.name }
    }
    if (
      patch.isPublic !== undefined &&
      patch.isPublic !== (current.isPublic ?? false)
    ) {
      next = { ...(next ?? current), isPublic: patch.isPublic }
    }
    if ("activityType" in patch) {
      const nextType = patch.activityType ?? undefined
      if (nextType !== current.activityType) {
        next = { ...(next ?? current), activityType: nextType }
      }
    }
    if ("startSunPhase" in patch) {
      const nextPhase = patch.startSunPhase ?? undefined
      if (nextPhase !== current.startSunPhase) {
        next = { ...(next ?? current), startSunPhase: nextPhase }
      }
    }
    if (!next) continue
    activities[index] = next
    updated.push(clone(next))
  }
}

function applyMetadataToSummary(
  summary: ActivitySummary,
  patch: ActivityMetadataPatch
): ActivitySummary | null {
  let next: ActivitySummary | null = null
  if (patch.name !== undefined && patch.name !== summary.name) {
    next = { ...(next ?? summary), name: patch.name }
  }
  if (
    patch.isPublic !== undefined &&
    patch.isPublic !== (summary.isPublic ?? false)
  ) {
    next = { ...(next ?? summary), isPublic: patch.isPublic }
  }
  if ("activityType" in patch) {
    const nextType = patch.activityType ?? undefined
    if (nextType !== summary.activityType) {
      next = { ...(next ?? summary) }
      if (nextType === undefined) delete next.activityType
      else next.activityType = nextType
    }
  }
  if ("startSunPhase" in patch) {
    const nextPhase = patch.startSunPhase ?? undefined
    if (nextPhase !== summary.startSunPhase) {
      next = { ...(next ?? summary) }
      if (nextPhase === undefined) delete next.startSunPhase
      else next.startSunPhase = nextPhase
    }
  }
  return next
}

function metadataCommitFromLibraryCommit(
  operationId: string,
  commit: LibraryCommit
): LibraryMetadataCommit {
  return {
    operationId,
    fromRevision: commit.change.fromRevision,
    revision: commit.snapshot.revision,
    coverageRevision: commit.snapshot.coverageRevision,
    updated: commit.change.updated.map(activityToSummary),
  }
}

export function applyLibraryCommand(
  current: LibrarySnapshot,
  command: LibraryCommand
): LibraryCommit {
  const activities = clone([...current.activities])
  const added: ParsedActivity[] = []
  const updated: ParsedActivity[] = []
  const removed: ParsedActivity[] = []
  const duplicates: DuplicateReason[] = []
  const domains: LibraryChangeDomains = {
    membership: false,
    geometry: false,
    metadata: false,
    statistics: false,
  }

  switch (command.type) {
    case "import":
      applyImport(activities, command.activities, duplicates)
      added.push(
        ...activities.filter(
          (activity) =>
            command.activities.some(
              (candidate) => candidate.id === activity.id
            ) &&
            !current.activities.some((existing) => existing.id === activity.id)
        )
      )
      if (added.length > 0) {
        domains.membership = true
        domains.geometry = true
      }
      break
    case "applyRemote":
      applyRemote(
        activities,
        command.changes,
        added,
        updated,
        removed,
        duplicates,
        domains
      )
      break
    case "delete": {
      const index = activities.findIndex(
        (activity) => activity.id === command.activityId
      )
      if (index >= 0) {
        removed.push(...activities.splice(index, 1))
        domains.membership = true
        domains.geometry = true
      }
      break
    }
    case "clearLocal":
      removed.push(...activities.splice(0, activities.length))
      if (removed.length > 0) {
        domains.membership = true
        domains.geometry = true
      }
      break
    case "updateMetadata":
      applyMetadata(activities, command.patches, updated)
      if (updated.length > 0) domains.metadata = true
      break
  }

  const changed = added.length > 0 || updated.length > 0 || removed.length > 0
  const revision = current.revision + (changed ? 1 : 0)
  const coverageRevision =
    current.coverageRevision +
    (changed && (domains.membership || domains.geometry) ? 1 : 0)
  const snapshot = immutableSnapshot(revision, coverageRevision, activities)
  const change: LibraryChange = {
    operationId: command.operationId,
    fromRevision: current.revision,
    revision,
    added: clone(added),
    updated: clone(updated),
    removed: clone(removed),
    duplicates: clone(duplicates),
    domains,
  }
  return { snapshot, change }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("Transaction aborted", "AbortError")
      )
    transaction.onerror = () => reject(transaction.error)
  })
}

async function abortAndWait(transaction: IDBTransaction): Promise<void> {
  try {
    transaction.abort()
  } catch {
    // The transaction may already have completed or aborted.
  }
  try {
    await transactionResult(transaction)
  } catch {
    // The caller is responsible for reporting the reason for the abort.
  }
}

class ActivitySummaryRecoveryRequired extends Error {
  constructor() {
    super(
      "The activity summary store is incomplete; it must be recovered before metadata can be changed."
    )
    this.name = "ActivitySummaryRecoveryRequired"
  }
}

function readMeta(value: unknown): StoredLibraryMeta {
  if (value == null) {
    return {
      key: LIBRARY_META_KEY,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      revision: 0,
      coverageRevision: 0,
    }
  }
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { key?: unknown }).key !== LIBRARY_META_KEY ||
    typeof (value as { revision?: unknown }).revision !== "number" ||
    !Number.isSafeInteger((value as { revision: number }).revision) ||
    (value as { revision: number }).revision < 0 ||
    ((value as { coverageRevision?: unknown }).coverageRevision !== undefined &&
      (typeof (value as { coverageRevision?: unknown }).coverageRevision !==
        "number" ||
        !Number.isSafeInteger(
          (value as { coverageRevision: number }).coverageRevision
        ) ||
        (value as { coverageRevision: number }).coverageRevision < 0))
  ) {
    throw createActivityStorageError(
      "schema",
      "The activity library metadata is invalid and cannot be opened.",
      { retryable: false }
    )
  }
  return {
    key: LIBRARY_META_KEY,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: (value as { revision: number }).revision,
    coverageRevision:
      typeof (value as { coverageRevision?: unknown }).coverageRevision ===
      "number"
        ? (value as { coverageRevision: number }).coverageRevision
        : (value as { revision: number }).revision,
  }
}

export interface IndexedDbActivityLibraryRepository extends ActivityLibraryRepository {}

export function createIndexedDbActivityLibraryRepository(): IndexedDbActivityLibraryRepository {
  async function loadSummarySnapshot(
    recovered = false
  ): Promise<LibrarySummarySnapshot> {
    const db = await openStorageDatabase()
    if (!db) {
      throw createActivityStorageError(
        "unavailable",
        "Browser storage is unavailable; activity summaries were not loaded."
      )
    }

    try {
      const transaction = db.transaction(
        ["activity-summaries", "library-meta"],
        "readonly"
      )
      const [rawSummaries, rawMeta] = await Promise.all([
        requestResult<unknown[]>(
          transaction.objectStore("activity-summaries").getAll()
        ),
        requestResult<StoredLibraryMeta | undefined>(
          transaction.objectStore("library-meta").get(LIBRARY_META_KEY)
        ),
      ])
      const summaries: ActivitySummary[] = []
      for (const summary of rawSummaries) {
        if (!isActivitySummary(summary)) {
          throw new ActivitySummaryRecoveryRequired()
        }
        summaries.push(summary)
      }
      const meta = readMeta(rawMeta)
      if (
        !rawMeta ||
        rawMeta.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
        rawMeta.coverageRevision === undefined
      ) {
        const migration = db.transaction("library-meta", "readwrite")
        migration.objectStore("library-meta").put(meta)
        await transactionResult(migration)
      }
      return {
        revision: meta.revision,
        coverageRevision: meta.coverageRevision,
        summaries: clone(summaries),
      }
    } catch (error) {
      if (error instanceof ActivitySummaryRecoveryRequired && !recovered) {
        await loadActivitySummaries()
        return loadSummarySnapshot(true)
      }
      throw toActivityStorageError(error, "loading activity summaries")
    }
  }

  async function load(): Promise<LibrarySnapshot> {
    const db = await openStorageDatabase()
    if (!db) {
      throw createActivityStorageError(
        "unavailable",
        "Browser storage is unavailable; the activity library was not loaded."
      )
    }

    try {
      const transaction = db.transaction(
        ["activities", "activity-summaries", "library-meta"],
        "readwrite"
      )
      const activitiesRequest = transaction.objectStore("activities").getAll()
      const summariesRequest = transaction
        .objectStore("activity-summaries")
        .getAll()
      const metaRequest = transaction
        .objectStore("library-meta")
        .get(LIBRARY_META_KEY)
      const [activities, summaries, rawMeta] = await Promise.all([
        requestResult<StoredActivity[]>(activitiesRequest),
        requestResult<ActivitySummary[]>(summariesRequest),
        requestResult<StoredLibraryMeta | undefined>(metaRequest),
      ])
      const meta = readMeta(rawMeta)
      if (
        !rawMeta ||
        rawMeta.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
        rawMeta.coverageRevision === undefined
      ) {
        transaction.objectStore("library-meta").put(meta)
      }
      await transactionResult(transaction)
      return immutableSnapshot(
        meta.revision,
        meta.coverageRevision,
        overlayActivitySummaries(activities, summaries)
      )
    } catch (error) {
      throw toActivityStorageError(error, "loading the activity library")
    }
  }

  async function commit(
    command: LibraryCommand,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    const db = await openStorageDatabase()
    if (!db) {
      throw createActivityStorageError(
        "unavailable",
        "Browser storage is unavailable; the activity was not saved."
      )
    }

    try {
      const hasOutbox =
        typeof options.outbox === "function" ||
        (options.outbox?.length ?? 0) > 0
      const transaction = db.transaction(
        hasOutbox
          ? ["activities", "activity-summaries", "library-meta", "sync-outbox"]
          : ["activities", "activity-summaries", "library-meta"],
        "readwrite"
      )
      const activityStore = transaction.objectStore("activities")
      const summaryStore = transaction.objectStore("activity-summaries")
      const metaStore = transaction.objectStore("library-meta")
      const outboxStore = hasOutbox
        ? transaction.objectStore("sync-outbox")
        : null
      const [activities, summaries, rawMeta] = await Promise.all([
        requestResult<StoredActivity[]>(activityStore.getAll()),
        requestResult<ActivitySummary[]>(summaryStore.getAll()),
        requestResult<StoredLibraryMeta | undefined>(
          metaStore.get(LIBRARY_META_KEY)
        ),
      ])
      const meta = readMeta(rawMeta)
      if (meta.revision !== expectedRevision) {
        transaction.abort()
        throw createActivityLibraryConflictError(
          expectedRevision,
          meta.revision
        )
      }

      const current = immutableSnapshot(
        meta.revision,
        meta.coverageRevision,
        overlayActivitySummaries(activities, summaries)
      )
      const result = applyLibraryCommand(current, command)
      for (const activity of result.change.added) {
        activityStore.put(activity)
        summaryStore.put(activityToSummary(activity))
      }
      for (const activity of result.change.updated) {
        activityStore.put(activity)
        summaryStore.put(activityToSummary(activity))
      }
      for (const activity of result.change.removed) {
        activityStore.delete(activity.id)
        summaryStore.delete(activity.id)
      }
      if (result.snapshot.revision !== meta.revision || !rawMeta) {
        metaStore.put({
          key: LIBRARY_META_KEY,
          schemaVersion: LIBRARY_SCHEMA_VERSION,
          revision: result.snapshot.revision,
          coverageRevision: result.snapshot.coverageRevision,
        } satisfies StoredLibraryMeta)
      }
      const resolvedOutbox = outboxInputs(options, result)
      if (outboxStore) {
        const existing = await requestResult<SyncOutboxItem[]>(
          outboxStore.getAll()
        )
        const byDedupeKey = new Map(
          existing.map((item) => [item.dedupeKey, item])
        )
        const now = Date.now()
        for (const input of resolvedOutbox) {
          const currentItem = byDedupeKey.get(input.dedupeKey)
          const next = currentItem
            ? mergeSyncOutboxItem(currentItem, input, now)
            : normaliseSyncOutboxItem(input, now)
          outboxStore.put(next)
          byDedupeKey.set(next.dedupeKey, next)
        }
      }
      await transactionResult(transaction)
      return result
    } catch (error) {
      if (isActivityLibraryConflictError(error)) throw error
      throw toActivityStorageError(error, "saving the activity library")
    }
  }

  async function commitMetadataTransaction(
    db: IDBDatabase,
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions
  ): Promise<LibraryMetadataCommit> {
    const hasOutbox = typeof options.metadataOutbox === "function"
    const transaction = db.transaction(
      hasOutbox
        ? ["library-meta", "activity-summaries", "sync-outbox"]
        : ["library-meta", "activity-summaries"],
      "readwrite"
    )
    const metaStore = transaction.objectStore("library-meta")
    const summaryStore = transaction.objectStore("activity-summaries")
    const outboxStore = hasOutbox
      ? transaction.objectStore("sync-outbox")
      : null

    // Issue one point lookup per requested id. In particular, do not touch the
    // geometry store on this path: activity-summaries owns mutable presentation
    // metadata and full activity loads overlay it when geometry is needed.
    const rawMetaRequest = metaStore.get(LIBRARY_META_KEY)
    const summaryRequests = command.patches.map((patch) =>
      summaryStore.get(patch.id)
    )
    const [rawMeta, ...rawSummaries] = await Promise.all([
      requestResult<StoredLibraryMeta | undefined>(rawMetaRequest),
      ...summaryRequests.map((request) => requestResult<unknown>(request)),
    ])
    const meta = readMeta(rawMeta)
    if (meta.revision !== expectedRevision) {
      await abortAndWait(transaction)
      throw createActivityLibraryConflictError(expectedRevision, meta.revision)
    }

    const summaries: ActivitySummary[] = []
    for (const summary of rawSummaries) {
      if (!isActivitySummary(summary)) {
        await abortAndWait(transaction)
        throw new ActivitySummaryRecoveryRequired()
      }
      summaries.push(summary)
    }
    const updated: ActivitySummary[] = []
    for (const [index, patch] of command.patches.entries()) {
      const next = applyMetadataToSummary(summaries[index]!, patch)
      if (!next) continue
      updated.push(next)
      summaryStore.put(next)
    }

    const result: LibraryMetadataCommit = {
      operationId: command.operationId,
      fromRevision: meta.revision,
      revision: meta.revision + (updated.length > 0 ? 1 : 0),
      coverageRevision: meta.coverageRevision,
      updated: clone(updated),
    }
    if (
      result.revision !== meta.revision ||
      !rawMeta ||
      rawMeta.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
      rawMeta.coverageRevision === undefined
    ) {
      metaStore.put({
        key: LIBRARY_META_KEY,
        schemaVersion: LIBRARY_SCHEMA_VERSION,
        revision: result.revision,
        coverageRevision: result.coverageRevision,
      } satisfies StoredLibraryMeta)
    }

    const resolvedOutbox = metadataOutboxInputs(options, result)
    if (outboxStore && resolvedOutbox.length > 0) {
      const existing = await requestResult<SyncOutboxItem[]>(
        outboxStore.getAll()
      )
      const byDedupeKey = new Map(
        existing.map((item) => [item.dedupeKey, item])
      )
      const now = Date.now()
      for (const input of resolvedOutbox) {
        const currentItem = byDedupeKey.get(input.dedupeKey)
        const next = currentItem
          ? mergeSyncOutboxItem(currentItem, input, now)
          : normaliseSyncOutboxItem(input, now)
        outboxStore.put(next)
        byDedupeKey.set(next.dedupeKey, next)
      }
    }

    await transactionResult(transaction)
    return result
  }

  async function commitMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryMetadataCommit> {
    assertValidActivityMetadataPatches(command.patches)
    const db = await openStorageDatabase()
    if (!db) {
      throw createActivityStorageError(
        "unavailable",
        "Browser storage is unavailable; the activity metadata was not saved."
      )
    }

    let recovered = false
    for (;;) {
      try {
        return await commitMetadataTransaction(
          db,
          command,
          expectedRevision,
          options
        )
      } catch (error) {
        if (error instanceof ActivitySummaryRecoveryRequired && !recovered) {
          recovered = true
          await loadActivitySummaries()
          continue
        }
        if (isActivityLibraryConflictError(error)) throw error
        throw toActivityStorageError(error, "saving activity metadata")
      }
    }
  }

  return { load, loadSummarySnapshot, commit, commitMetadata }
}

/** Deterministic repository for service tests and non-browser adapters. */
export interface MemoryActivityLibraryRepository extends ActivityLibraryRepository {
  failNext(error: unknown): void
  getOutbox(): SyncOutboxItem[]
}

export function createMemoryActivityLibraryRepository(
  activities: ParsedActivity[] = [],
  revision = 0
): MemoryActivityLibraryRepository {
  let state = immutableSnapshot(revision, revision, activities)
  let failure: unknown = null
  const outbox = new Map<string, SyncOutboxItem>()

  function failNext(error: unknown): void {
    failure = error
  }

  async function load(): Promise<LibrarySnapshot> {
    if (failure !== null) {
      const error = failure
      failure = null
      throw error
    }
    return immutableSnapshot(state.revision, state.coverageRevision, [
      ...state.activities,
    ])
  }

  async function loadSummarySnapshot(): Promise<LibrarySummarySnapshot> {
    if (failure !== null) {
      const error = failure
      failure = null
      throw error
    }
    return {
      revision: state.revision,
      coverageRevision: state.coverageRevision,
      summaries: clone(state.activities.map(activityToSummary)),
    }
  }

  async function commit(
    command: LibraryCommand,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    if (failure !== null) {
      const error = failure
      failure = null
      throw error
    }
    if (expectedRevision !== state.revision) {
      throw createActivityLibraryConflictError(expectedRevision, state.revision)
    }
    const result = applyLibraryCommand(state, command)
    state = result.snapshot
    for (const input of outboxInputs(options, result)) {
      const existing = [...outbox.values()].find(
        (item) => item.dedupeKey === input.dedupeKey
      )
      const now = Date.now()
      const next = existing
        ? mergeSyncOutboxItem(existing, input, now)
        : normaliseSyncOutboxItem(input, now)
      outbox.set(next.id, next)
    }
    return result
  }

  async function commitMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryMetadataCommit> {
    assertValidActivityMetadataPatches(command.patches)
    if (failure !== null) {
      const error = failure
      failure = null
      throw error
    }
    if (expectedRevision !== state.revision) {
      throw createActivityLibraryConflictError(expectedRevision, state.revision)
    }
    const result = applyLibraryCommand(state, command)
    state = result.snapshot
    const metadataCommit = metadataCommitFromLibraryCommit(
      command.operationId,
      result
    )
    for (const input of metadataOutboxInputs(options, metadataCommit)) {
      const existing = [...outbox.values()].find(
        (item) => item.dedupeKey === input.dedupeKey
      )
      const now = Date.now()
      const next = existing
        ? mergeSyncOutboxItem(existing, input, now)
        : normaliseSyncOutboxItem(input, now)
      outbox.set(next.id, next)
    }
    return metadataCommit
  }

  function getOutbox(): SyncOutboxItem[] {
    return [...outbox.values()].map(clone)
  }

  return {
    load,
    loadSummarySnapshot,
    commit,
    commitMetadata,
    failNext,
    getOutbox,
  }
}
