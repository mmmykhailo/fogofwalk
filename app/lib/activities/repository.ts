import type { ParsedActivity } from "~/types/activities"
import { openStorageDatabase } from "~/lib/storage"
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
  DuplicateReason,
  LibraryChange,
  LibraryCommand,
  LibraryCommit,
  LibraryRevision,
  LibrarySnapshot,
  RemoteChange,
} from "./libraryEvents"

export const LIBRARY_SCHEMA_VERSION = 1
export const LIBRARY_META_KEY = "library"

interface StoredLibraryMeta {
  key: typeof LIBRARY_META_KEY
  schemaVersion: number
  revision: LibraryRevision
}

export interface ActivityLibraryRepository {
  load(): Promise<LibrarySnapshot>
  commit(
    command: LibraryCommand,
    expectedRevision: number,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryCommit>
}

/** Durable effects that must be committed with a canonical library mutation. */
export interface ActivityLibraryCommitOptions {
  outbox?: readonly SyncOutboxItemInput[]
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function immutableSnapshot(
  revision: LibraryRevision,
  activities: ParsedActivity[]
): LibrarySnapshot {
  // Clone before freezing so callers cannot mutate repository-owned records.
  const records = clone(activities)
  return {
    revision,
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
  duplicates: DuplicateReason[]
): ParsedActivity[] {
  for (const change of changes) {
    if (change.type === "delete") {
      const index = findByHash(activities, change.contentHash)
      if (index >= 0) removed.push(...activities.splice(index, 1))
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
      }
      continue
    }

    if (activities.some((activity) => activity.id === incoming.id)) {
      duplicates.push(duplicate(incoming, "remote-content-hash"))
      continue
    }
    activities.push(incoming)
    added.push(clone(incoming))
  }
  return activities
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
      break
    case "applyRemote":
      applyRemote(
        activities,
        command.changes,
        added,
        updated,
        removed,
        duplicates
      )
      break
    case "delete": {
      const index = activities.findIndex(
        (activity) => activity.id === command.activityId
      )
      if (index >= 0) removed.push(...activities.splice(index, 1))
      break
    }
    case "clearLocal":
      removed.push(...activities.splice(0, activities.length))
      break
  }

  const changed = added.length > 0 || updated.length > 0 || removed.length > 0
  const revision = current.revision + (changed ? 1 : 0)
  const snapshot = immutableSnapshot(revision, activities)
  const change: LibraryChange = {
    operationId: command.operationId,
    fromRevision: current.revision,
    revision,
    added: clone(added),
    updated: clone(updated),
    removed: clone(removed),
    duplicates: clone(duplicates),
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

function readMeta(value: unknown): StoredLibraryMeta {
  if (value == null) {
    return {
      key: LIBRARY_META_KEY,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      revision: 0,
    }
  }
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { key?: unknown }).key !== LIBRARY_META_KEY ||
    typeof (value as { revision?: unknown }).revision !== "number" ||
    !Number.isSafeInteger((value as { revision: number }).revision) ||
    (value as { revision: number }).revision < 0
  ) {
    throw createActivityStorageError(
      "schema",
      "The activity library metadata is invalid and cannot be opened.",
      { retryable: false }
    )
  }
  return {
    key: LIBRARY_META_KEY,
    schemaVersion:
      typeof (value as { schemaVersion?: unknown }).schemaVersion === "number"
        ? (value as { schemaVersion: number }).schemaVersion
        : LIBRARY_SCHEMA_VERSION,
    revision: (value as { revision: number }).revision,
  }
}

export class IndexedDbActivityLibraryRepository implements ActivityLibraryRepository {
  async load(): Promise<LibrarySnapshot> {
    const db = await openStorageDatabase()
    if (!db) {
      throw createActivityStorageError(
        "unavailable",
        "Browser storage is unavailable; the activity library was not loaded."
      )
    }

    try {
      const transaction = db.transaction(
        ["activities", "library-meta"],
        "readwrite"
      )
      const activitiesRequest = transaction.objectStore("activities").getAll()
      const metaRequest = transaction
        .objectStore("library-meta")
        .get(LIBRARY_META_KEY)
      const [activities, rawMeta] = await Promise.all([
        requestResult<ParsedActivity[]>(activitiesRequest),
        requestResult<StoredLibraryMeta | undefined>(metaRequest),
      ])
      const meta = readMeta(rawMeta)
      if (!rawMeta) transaction.objectStore("library-meta").put(meta)
      await transactionResult(transaction)
      return immutableSnapshot(meta.revision, activities)
    } catch (error) {
      throw toActivityStorageError(error, "loading the activity library")
    }
  }

  async commit(
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
      const hasOutbox = (options.outbox?.length ?? 0) > 0
      const transaction = db.transaction(
        hasOutbox
          ? ["activities", "library-meta", "sync-outbox"]
          : ["activities", "library-meta"],
        "readwrite"
      )
      const activityStore = transaction.objectStore("activities")
      const metaStore = transaction.objectStore("library-meta")
      const outboxStore = hasOutbox
        ? transaction.objectStore("sync-outbox")
        : null
      const [activities, rawMeta] = await Promise.all([
        requestResult<ParsedActivity[]>(activityStore.getAll()),
        requestResult<StoredLibraryMeta | undefined>(
          metaStore.get(LIBRARY_META_KEY)
        ),
      ])
      const meta = readMeta(rawMeta)
      if (meta.revision !== expectedRevision) {
        transaction.abort()
        throw createActivityLibraryConflictError(expectedRevision, meta.revision)
      }

      const current = immutableSnapshot(meta.revision, activities)
      const result = applyLibraryCommand(current, command)
      for (const activity of result.change.added) activityStore.put(activity)
      for (const activity of result.change.updated) activityStore.put(activity)
      for (const activity of result.change.removed)
        activityStore.delete(activity.id)
      if (result.snapshot.revision !== meta.revision || !rawMeta) {
        metaStore.put({
          key: LIBRARY_META_KEY,
          schemaVersion: LIBRARY_SCHEMA_VERSION,
          revision: result.snapshot.revision,
        } satisfies StoredLibraryMeta)
      }
      if (outboxStore) {
        const existing = await requestResult<SyncOutboxItem[]>(
          outboxStore.getAll()
        )
        const byDedupeKey = new Map(
          existing.map((item) => [item.dedupeKey, item])
        )
        const now = Date.now()
        for (const input of options.outbox ?? []) {
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
}

/** Deterministic repository for service tests and non-browser adapters. */
export class MemoryActivityLibraryRepository implements ActivityLibraryRepository {
  private state: LibrarySnapshot
  private failure: unknown = null

  constructor(activities: ParsedActivity[] = [], revision = 0) {
    this.state = immutableSnapshot(revision, activities)
  }

  failNext(error: unknown): void {
    this.failure = error
  }

  async load(): Promise<LibrarySnapshot> {
    if (this.failure !== null) {
      const error = this.failure
      this.failure = null
      throw error
    }
    return immutableSnapshot(this.state.revision, [...this.state.activities])
  }

  async commit(
    command: LibraryCommand,
    expectedRevision: number,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    if (this.failure !== null) {
      const error = this.failure
      this.failure = null
      throw error
    }
    if (expectedRevision !== this.state.revision) {
      throw createActivityLibraryConflictError(
        expectedRevision,
        this.state.revision
      )
    }
    const result = applyLibraryCommand(this.state, command)
    this.state = result.snapshot
    for (const input of options.outbox ?? []) {
      const existing = [...this.outbox.values()].find(
        (item) => item.dedupeKey === input.dedupeKey
      )
      const now = Date.now()
      const next = existing
        ? mergeSyncOutboxItem(existing, input, now)
        : normaliseSyncOutboxItem(input, now)
      this.outbox.set(next.id, next)
    }
    return result
  }

  private readonly outbox = new Map<string, SyncOutboxItem>()

  getOutbox(): SyncOutboxItem[] {
    return [...this.outbox.values()].map(clone)
  }
}
