import {
  createActivityStorageError,
  isActivityLibraryConflictError,
} from "./errors"
import {
  createIndexedDbActivityLibraryRepository,
  type ActivityLibraryCommitOptions,
  type ActivityLibraryRepository,
} from "./repository"
import type {
  ActivityMetadataPatch,
  LibraryCommand,
  LibraryCommit,
  LibraryChange,
  LibraryListener,
  LibraryMetadataCommit,
  LibrarySnapshot,
} from "./libraryEvents"

const CHANNEL_NAME = "fogofwalk:activity-library"
const LOCK_NAME = "fogofwalk:activity-library-write"

function cloneSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  const activities =
    typeof structuredClone === "function"
      ? structuredClone([...snapshot.activities])
      : JSON.parse(JSON.stringify(snapshot.activities))
  return {
    revision: snapshot.revision,
    coverageRevision: snapshot.coverageRevision,
    activities: Object.freeze(
      (activities as unknown[]).map((activity) => Object.freeze(activity))
    ) as LibrarySnapshot["activities"],
  }
}

function cloneChange(change: LibraryChange): LibraryChange {
  if (typeof structuredClone === "function") return structuredClone(change)
  return JSON.parse(JSON.stringify(change)) as LibraryChange
}

function applySummaryMetadata(
  activity: LibrarySnapshot["activities"][number],
  summary: LibraryMetadataCommit["updated"][number]
): LibrarySnapshot["activities"][number] {
  let next: LibrarySnapshot["activities"][number] | null = null
  if (summary.name !== activity.name) {
    next = { ...(next ?? activity), name: summary.name }
  }
  const isPublic = summary.isPublic ?? false
  if (isPublic !== (activity.isPublic ?? false)) {
    next = { ...(next ?? activity), isPublic }
  }
  if (summary.activityType !== activity.activityType) {
    next = { ...(next ?? activity) }
    if (summary.activityType === undefined) delete next.activityType
    else next.activityType = summary.activityType
  }
  if (summary.startSunPhase !== activity.startSunPhase) {
    next = { ...(next ?? activity) }
    if (summary.startSunPhase === undefined) delete next.startSunPhase
    else next.startSunPhase = summary.startSunPhase
  }
  return next ?? activity
}

function reconcileMetadataCommit(
  base: LibrarySnapshot,
  command: Extract<LibraryCommand, { type: "updateMetadata" }>,
  metadata: LibraryMetadataCommit
): LibraryCommit {
  const summariesById = new Map(
    metadata.updated.map((summary) => [summary.id, summary])
  )
  const changedById = new Map<string, LibrarySnapshot["activities"][number]>()
  for (const patch of command.patches as readonly ActivityMetadataPatch[]) {
    const summary = summariesById.get(patch.id)
    const current = base.activities.find((activity) => activity.id === patch.id)
    if (!summary || !current) continue
    const next = applySummaryMetadata(current, summary)
    if (next !== current) changedById.set(current.id, next)
  }
  const activities = base.activities.map(
    (activity) => changedById.get(activity.id) ?? activity
  )
  const updated = metadata.updated.flatMap((summary) => {
    const activity = changedById.get(summary.id)
    return activity ? [activity] : []
  })
  const snapshot: LibrarySnapshot = {
    revision: metadata.revision,
    coverageRevision: metadata.coverageRevision,
    activities: Object.freeze(activities),
  }
  return {
    snapshot,
    change: {
      operationId: metadata.operationId,
      fromRevision: metadata.fromRevision,
      revision: metadata.revision,
      added: [],
      updated,
      removed: [],
      duplicates: [],
      domains: {
        membership: false,
        geometry: false,
        metadata: metadata.updated.length > 0,
        statistics: false,
      },
    },
  }
}

function sameActivity(
  first: LibrarySnapshot["activities"][number],
  second: LibrarySnapshot["activities"][number]
): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function changeBetween(
  previous: LibrarySnapshot,
  next: LibrarySnapshot
): LibraryChange {
  const previousById = new Map(
    previous.activities.map((activity) => [activity.id, activity])
  )
  const nextById = new Map(
    next.activities.map((activity) => [activity.id, activity])
  )
  const added = next.activities.filter(
    (activity) => !previousById.has(activity.id)
  )
  const updated = next.activities.filter((activity) => {
    const old = previousById.get(activity.id)
    return old !== undefined && !sameActivity(old, activity)
  })
  const removed = previous.activities.filter(
    (activity) => !nextById.has(activity.id)
  )
  const domains = {
    membership: added.length > 0 || removed.length > 0,
    geometry: added.length > 0 || removed.length > 0,
    metadata: false,
    statistics: false,
  }
  for (const activity of updated) {
    const old = previousById.get(activity.id)
    if (
      old?.contentHash &&
      activity.contentHash &&
      old.contentHash === activity.contentHash
    ) {
      domains.metadata = true
    } else {
      domains.geometry = true
    }
  }
  return cloneChange({
    operationId: `external:${next.revision}`,
    fromRevision: previous.revision,
    revision: next.revision,
    added: [...added],
    updated: [...updated],
    removed: [...removed],
    duplicates: [],
    domains,
  })
}

function safeNavigatorLocks(): LockManager | null {
  if (typeof navigator === "undefined" || !navigator.locks) return null
  return navigator.locks
}

/**
 * The sole command owner for canonical activities in a browser tab.
 *
 * The repository provides atomic revision checks. This service adds ordered
 * commands, immutable snapshots, optional Web Locks, and revision notifications
 * for other tabs. A conflict retries the same command against the newly loaded
 * revision, so concurrent imports form a union instead of overwriting a tab.
 */
export interface ActivityLibrary {
  initialize(): Promise<LibrarySnapshot>
  getSnapshot(): LibrarySnapshot
  subscribe(listener: LibraryListener): () => void
  dispatch(
    command: LibraryCommand,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryCommit>
  refresh(): Promise<void>
  close(): void
}

export function createActivityLibrary(
  repository: ActivityLibraryRepository = createIndexedDbActivityLibraryRepository()
): ActivityLibrary {
  let snapshot: LibrarySnapshot | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<LibraryListener>()
  let channel: BroadcastChannel | null = null
  let refreshPromise: Promise<void> | null = null

  async function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = enqueue(async () => {
      const next = cloneSnapshot(await repository.load())
      if (!snapshot || next.revision > snapshot.revision) {
        const previous = snapshot
        snapshot = next
        if (previous) {
          const change = changeBetween(previous, next)
          for (const listener of listeners) {
            listener(cloneSnapshot(next), cloneChange(change))
          }
        }
      }
    }).finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  if (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as { revision?: unknown }).revision !== "number"
      ) {
        return
      }
      const revision = (data as { revision: number }).revision
      if ((snapshot?.revision ?? -1) < revision) void refresh()
    }
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const locks = safeNavigatorLocks()
    if (!locks) return operation()
    return locks.request(LOCK_NAME, { mode: "exclusive" }, operation)
  }

  async function initialize(): Promise<LibrarySnapshot> {
    return enqueue(async () => {
      if (!snapshot) snapshot = cloneSnapshot(await repository.load())
      return cloneSnapshot(snapshot)
    })
  }

  function getSnapshot(): LibrarySnapshot {
    if (!snapshot) {
      throw createActivityStorageError(
        "unavailable",
        "The activity library has not finished loading."
      )
    }
    return cloneSnapshot(snapshot)
  }

  function subscribe(listener: LibraryListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function dispatch(
    command: LibraryCommand,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    return enqueue(async () => {
      if (!snapshot) snapshot = cloneSnapshot(await repository.load())

      if (command.type === "updateMetadata") {
        let attempt = 0
        while (attempt < 2) {
          attempt++
          const base = snapshot!
          const metadata = await withWriteLock(() =>
            repository.commitMetadata(command, base.revision, options)
          ).catch(async (error: unknown) => {
            if (!isActivityLibraryConflictError(error) || attempt >= 2) {
              throw error
            }
            snapshot = cloneSnapshot(await repository.load())
            return null
          })
          if (!metadata) continue

          const commit = reconcileMetadataCommit(base, command, metadata)
          snapshot = cloneSnapshot(commit.snapshot)
          for (const listener of listeners) {
            listener(cloneSnapshot(commit.snapshot), cloneChange(commit.change))
          }
          channel?.postMessage({ revision: commit.snapshot.revision })
          return {
            snapshot: cloneSnapshot(commit.snapshot),
            change: cloneChange(commit.change),
          }
        }
        throw new Error("Activity library conflict did not resolve")
      }

      let attempt = 0
      while (attempt < 2) {
        attempt++
        const base = snapshot!
        const commit = await withWriteLock(() =>
          repository.commit(command, base.revision, options)
        ).catch(async (error: unknown) => {
          if (!isActivityLibraryConflictError(error) || attempt >= 2) {
            throw error
          }
          snapshot = cloneSnapshot(await repository.load())
          return null
        })
        if (!commit) continue

        snapshot = cloneSnapshot(commit.snapshot)
        // `change` is already detached by the repository. The local object is
        // kept separate from the returned commit so listeners cannot mutate it.
        for (const listener of listeners) {
          listener(cloneSnapshot(commit.snapshot), cloneChange(commit.change))
        }
        channel?.postMessage({ revision: commit.snapshot.revision })
        return {
          snapshot: cloneSnapshot(commit.snapshot),
          change: cloneChange(commit.change),
        }
      }
      throw new Error("Activity library conflict did not resolve")
    })
  }

  function close(): void {
    channel?.close()
    channel = null
    listeners.clear()
  }

  return {
    initialize,
    getSnapshot,
    subscribe,
    dispatch,
    refresh,
    close,
  }
}
