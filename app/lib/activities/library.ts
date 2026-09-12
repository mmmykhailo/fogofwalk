import {
  createActivityStorageError,
  isActivityLibraryConflictError,
} from "./errors"
import type { ParsedActivity } from "~/types/activities"
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
  LibraryMetadataListener,
  LibrarySnapshot,
  LibrarySummarySnapshot,
} from "./libraryEvents"
import { activityToSummary, isActivitySummary } from "~/lib/storage"

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
      (activities as ParsedActivity[]).map((activity) =>
        freezeActivity(activity)
      )
    ) as LibrarySnapshot["activities"],
  }
}

function freezeActivity(activity: ParsedActivity): ParsedActivity {
  return Object.isFrozen(activity) ? activity : Object.freeze(activity)
}

/** Keep the canonical full snapshot structurally shared across metadata edits. */
function shareSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    revision: snapshot.revision,
    coverageRevision: snapshot.coverageRevision,
    activities: Object.freeze(
      snapshot.activities.map((activity) => freezeActivity(activity))
    ),
  }
}

function cloneChange(change: LibraryChange): LibraryChange {
  if (typeof structuredClone === "function") return structuredClone(change)
  return JSON.parse(JSON.stringify(change)) as LibraryChange
}

function cloneSummarySnapshot(
  snapshot: LibrarySummarySnapshot
): LibrarySummarySnapshot {
  const summaries =
    typeof structuredClone === "function"
      ? structuredClone([...snapshot.summaries])
      : JSON.parse(JSON.stringify(snapshot.summaries))
  return {
    revision: snapshot.revision,
    coverageRevision: snapshot.coverageRevision,
    summaries: Object.freeze(
      (summaries as LibrarySummarySnapshot["summaries"]).map((summary) =>
        Object.freeze({
          ...summary,
          stats: Object.freeze({ ...summary.stats }),
        })
      )
    ) as LibrarySummarySnapshot["summaries"],
  }
}

function applyMetadataCommitToSummarySnapshot(
  snapshot: LibrarySummarySnapshot,
  commit: LibraryMetadataCommit
): LibrarySummarySnapshot {
  const updatedById = new Map(
    commit.updated.map((summary) => [summary.id, summary])
  )
  return cloneSummarySnapshot({
    revision: commit.revision,
    coverageRevision: commit.coverageRevision,
    summaries: snapshot.summaries.map(
      (summary) => updatedById.get(summary.id) ?? summary
    ),
  })
}

function applyMetadataCommitToFullSnapshot(
  snapshot: LibrarySnapshot,
  commit: LibraryMetadataCommit
): { snapshot: LibrarySnapshot; updated: ParsedActivity[] } {
  const updatedById = new Map(
    commit.updated.map((summary) => [summary.id, summary])
  )
  const updated: ParsedActivity[] = []
  const activities = snapshot.activities.map((activity) => {
    const summary = updatedById.get(activity.id)
    if (!summary) return activity
    const next = applySummaryMetadata(activity, summary)
    if (next !== activity) updated.push(next)
    return next
  })
  return {
    snapshot: {
      revision: commit.revision,
      coverageRevision: commit.coverageRevision,
      activities: Object.freeze(activities),
    },
    updated,
  }
}

function metadataChange(
  fromRevision: number,
  commit: LibraryMetadataCommit,
  updated: ParsedActivity[]
): LibraryChange {
  return {
    operationId: commit.operationId,
    fromRevision,
    revision: commit.revision,
    added: [],
    updated,
    removed: [],
    duplicates: [],
    domains: {
      membership: false,
      geometry: false,
      metadata: updated.length > 0,
      statistics: false,
    },
  }
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
  return next ? freezeActivity(next) : activity
}

function reconcileMetadataCommit(
  base: LibrarySnapshot,
  command: Extract<LibraryCommand, { type: "updateMetadata" }>,
  metadata: LibraryMetadataCommit
): LibraryCommit {
  const summariesById = new Map(
    metadata.updated.map((summary) => [summary.id, summary])
  )
  const activitiesById = new Map(
    base.activities.map((activity) => [activity.id, activity])
  )
  const changedById = new Map<string, LibrarySnapshot["activities"][number]>()
  for (const patch of command.patches as readonly ActivityMetadataPatch[]) {
    const summary = summariesById.get(patch.id)
    const current = activitiesById.get(patch.id)
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
  const snapshot = shareSnapshot({
    revision: metadata.revision,
    coverageRevision: metadata.coverageRevision,
    activities,
  })
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
  initializeSummarySnapshot(): Promise<LibrarySummarySnapshot>
  getSnapshot(): LibrarySnapshot
  getSummarySnapshot(): LibrarySummarySnapshot
  subscribe(listener: LibraryListener): () => void
  subscribeMetadata(listener: LibraryMetadataListener): () => void
  dispatch(
    command: LibraryCommand,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryCommit>
  dispatchMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    options?: ActivityLibraryCommitOptions
  ): Promise<LibraryMetadataCommit>
  refresh(): Promise<void>
  close(): void
}

export function createActivityLibrary(
  repository: ActivityLibraryRepository = createIndexedDbActivityLibraryRepository()
): ActivityLibrary {
  let snapshot: LibrarySnapshot | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<LibraryListener>()
  const metadataListeners = new Set<LibraryMetadataListener>()
  let channel: BroadcastChannel | null = null
  let refreshPromise: Promise<void> | null = null
  let summaryRefreshPromise: Promise<void> | null = null
  let summarySnapshot: LibrarySummarySnapshot | null = null

  function notifyMetadataListeners(
    next: LibrarySummarySnapshot,
    commit: LibraryMetadataCommit
  ): void {
    for (const listener of metadataListeners) {
      listener(cloneSummarySnapshot(next), {
        ...commit,
        updated: commit.updated.map((summary) => ({
          ...summary,
          stats: { ...summary.stats },
        })),
      })
    }
  }

  function postMetadataBroadcast(commit: LibraryMetadataCommit): void {
    if (commit.updated.length === 0) return
    channel?.postMessage({
      kind: "metadata",
      fromRevision: commit.fromRevision,
      revision: commit.revision,
      coverageRevision: commit.coverageRevision,
      operationId: commit.operationId,
      updated: commit.updated.map((summary) => ({
        ...summary,
        stats: { ...summary.stats },
      })),
    })
  }

  function summaryCommitBetween(
    previous: LibrarySummarySnapshot,
    next: LibrarySummarySnapshot,
    operationId: string
  ): LibraryMetadataCommit {
    const previousById = new Map(
      previous.summaries.map((summary) => [summary.id, summary])
    )
    const updated = next.summaries.filter((summary) => {
      const old = previousById.get(summary.id)
      return old != null && JSON.stringify(old) !== JSON.stringify(summary)
    })
    return {
      operationId,
      fromRevision: previous.revision,
      revision: next.revision,
      coverageRevision: next.coverageRevision,
      updated: updated.map((summary) => ({
        ...summary,
        stats: { ...summary.stats },
      })),
    }
  }

  function applyFullMetadataCommit(commit: LibraryMetadataCommit): boolean {
    if (!snapshot) return false
    if (
      commit.fromRevision !== snapshot.revision ||
      commit.revision !== snapshot.revision + 1 ||
      commit.coverageRevision !== snapshot.coverageRevision
    ) {
      return false
    }
    const result = applyMetadataCommitToFullSnapshot(snapshot, commit)
    snapshot = result.snapshot
    for (const listener of listeners) {
      listener(
        snapshot,
        cloneChange(metadataChange(commit.fromRevision, commit, result.updated))
      )
    }
    return true
  }

  function applySummaryMetadataCommit(commit: LibraryMetadataCommit): boolean {
    if (!summarySnapshot) return false
    if (
      commit.fromRevision !== summarySnapshot.revision ||
      commit.revision !== summarySnapshot.revision + 1 ||
      commit.coverageRevision !== summarySnapshot.coverageRevision
    ) {
      return false
    }
    summarySnapshot = applyMetadataCommitToSummarySnapshot(
      summarySnapshot,
      commit
    )
    notifyMetadataListeners(summarySnapshot, commit)
    return true
  }

  async function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = enqueue(async () => {
      const next = cloneSnapshot(await repository.load())
      if (!snapshot || next.revision > snapshot.revision) {
        const previous = snapshot
        snapshot = next
        summarySnapshot = null
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

  async function refreshSummarySnapshot(): Promise<void> {
    if (summaryRefreshPromise) return summaryRefreshPromise
    summaryRefreshPromise = enqueue(async () => {
      const next = cloneSummarySnapshot(await repository.loadSummarySnapshot())
      if (!summarySnapshot || next.revision <= summarySnapshot.revision) return
      const previous = summarySnapshot
      summarySnapshot = next
      const commit = summaryCommitBetween(
        previous,
        next,
        `external:${next.revision}`
      )
      if (commit.updated.length > 0) {
        notifyMetadataListeners(next, commit)
      }
    }).finally(() => {
      summaryRefreshPromise = null
    })
    return summaryRefreshPromise
  }

  function isMetadataBroadcast(
    value: unknown
  ): value is LibraryMetadataCommit & { kind: "metadata" } {
    if (
      !value ||
      typeof value !== "object" ||
      (value as { kind?: unknown }).kind !== "metadata" ||
      typeof (value as { fromRevision?: unknown }).fromRevision !== "number" ||
      typeof (value as { revision?: unknown }).revision !== "number" ||
      typeof (value as { coverageRevision?: unknown }).coverageRevision !==
        "number" ||
      typeof (value as { operationId?: unknown }).operationId !== "string" ||
      !Array.isArray((value as { updated?: unknown }).updated)
    ) {
      return false
    }
    const data = value as LibraryMetadataCommit
    return data.updated.every((summary) => isActivitySummary(summary))
  }

  if (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (isMetadataBroadcast(data)) {
        if (snapshot && snapshot.revision < data.revision) {
          if (
            !applyFullMetadataCommit({
              operationId: data.operationId,
              fromRevision: data.fromRevision,
              revision: data.revision,
              coverageRevision: data.coverageRevision,
              updated: data.updated,
            })
          ) {
            void refresh()
          }
          return
        }
        if (summarySnapshot && summarySnapshot.revision < data.revision) {
          if (
            !applySummaryMetadataCommit({
              operationId: data.operationId,
              fromRevision: data.fromRevision,
              revision: data.revision,
              coverageRevision: data.coverageRevision,
              updated: data.updated,
            })
          ) {
            if (summarySnapshot.coverageRevision === data.coverageRevision) {
              void refreshSummarySnapshot()
            } else {
              void refresh()
            }
          }
          return
        }
        if (!snapshot && !summarySnapshot) void refreshSummarySnapshot()
        return
      }
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as { revision?: unknown }).revision !== "number"
      ) {
        return
      }
      const revision = (data as { revision: number }).revision
      if (snapshot && snapshot.revision < revision) {
        void refresh()
      } else if (summarySnapshot && summarySnapshot.revision < revision) {
        const nextCoverageRevision = (
          data as {
            coverageRevision?: unknown
          }
        ).coverageRevision
        if (
          typeof nextCoverageRevision === "number" &&
          nextCoverageRevision === summarySnapshot.coverageRevision
        ) {
          void refreshSummarySnapshot()
        } else {
          void refresh()
        }
      }
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
      if (!snapshot) {
        snapshot = cloneSnapshot(await repository.load())
        summarySnapshot = null
      }
      return cloneSnapshot(snapshot)
    })
  }

  async function initializeSummarySnapshot(): Promise<LibrarySummarySnapshot> {
    return enqueue(async () => {
      if (snapshot) {
        return cloneSummarySnapshot({
          revision: snapshot.revision,
          coverageRevision: snapshot.coverageRevision,
          summaries: snapshot.activities.map(activityToSummary),
        })
      }
      if (!summarySnapshot) {
        summarySnapshot = cloneSummarySnapshot(
          await repository.loadSummarySnapshot()
        )
      }
      return cloneSummarySnapshot(summarySnapshot)
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

  function getSummarySnapshot(): LibrarySummarySnapshot {
    if (snapshot) {
      return cloneSummarySnapshot({
        revision: snapshot.revision,
        coverageRevision: snapshot.coverageRevision,
        summaries: snapshot.activities.map(activityToSummary),
      })
    }
    if (!summarySnapshot) {
      throw createActivityStorageError(
        "unavailable",
        "The activity summaries have not finished loading."
      )
    }
    return cloneSummarySnapshot(summarySnapshot)
  }

  function subscribe(listener: LibraryListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function subscribeMetadata(listener: LibraryMetadataListener): () => void {
    metadataListeners.add(listener)
    return () => metadataListeners.delete(listener)
  }

  async function dispatchFullMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    options: ActivityLibraryCommitOptions
  ): Promise<{ commit: LibraryCommit; metadata: LibraryMetadataCommit }> {
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
        summarySnapshot = null
        return null
      })
      if (!metadata) continue

      const commit = reconcileMetadataCommit(base, command, metadata)
      snapshot = commit.snapshot
      if (metadata.updated.length > 0) {
        for (const listener of listeners) {
          listener(commit.snapshot, cloneChange(commit.change))
        }
        postMetadataBroadcast(metadata)
      }
      return {
        commit: {
          snapshot: cloneSnapshot(commit.snapshot),
          change: cloneChange(commit.change),
        },
        metadata: {
          ...metadata,
          updated: metadata.updated.map((summary) => ({
            ...summary,
            stats: { ...summary.stats },
          })),
        },
      }
    }
    throw new Error("Activity library conflict did not resolve")
  }

  async function dispatch(
    command: LibraryCommand,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    return enqueue(async () => {
      if (!snapshot) snapshot = cloneSnapshot(await repository.load())

      if (command.type === "updateMetadata") {
        const { commit } = await dispatchFullMetadata(command, options)
        return commit
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
        channel?.postMessage({
          kind: "revision",
          revision: commit.snapshot.revision,
          coverageRevision: commit.snapshot.coverageRevision,
        })
        return {
          snapshot: cloneSnapshot(commit.snapshot),
          change: cloneChange(commit.change),
        }
      }
      throw new Error("Activity library conflict did not resolve")
    })
  }

  async function dispatchMetadata(
    command: Extract<LibraryCommand, { type: "updateMetadata" }>,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryMetadataCommit> {
    return enqueue(async () => {
      if (snapshot) {
        return (await dispatchFullMetadata(command, options)).metadata
      }
      if (!summarySnapshot) {
        summarySnapshot = cloneSummarySnapshot(
          await repository.loadSummarySnapshot()
        )
      }

      let attempt = 0
      while (attempt < 2) {
        attempt++
        const base = summarySnapshot!
        const metadata = await withWriteLock(() =>
          repository.commitMetadata(command, base.revision, options)
        ).catch(async (error: unknown) => {
          if (!isActivityLibraryConflictError(error) || attempt >= 2) {
            throw error
          }
          summarySnapshot = cloneSummarySnapshot(
            await repository.loadSummarySnapshot()
          )
          return null
        })
        if (!metadata) continue

        summarySnapshot = applyMetadataCommitToSummarySnapshot(base, metadata)
        if (metadata.updated.length > 0) {
          notifyMetadataListeners(summarySnapshot, metadata)
          postMetadataBroadcast(metadata)
        }
        return {
          ...metadata,
          updated: metadata.updated.map((summary) => ({
            ...summary,
            stats: { ...summary.stats },
          })),
        }
      }
      throw new Error("Activity library conflict did not resolve")
    })
  }

  function close(): void {
    channel?.close()
    channel = null
    listeners.clear()
    metadataListeners.clear()
  }

  return {
    initialize,
    initializeSummarySnapshot,
    getSnapshot,
    getSummarySnapshot,
    subscribe,
    subscribeMetadata,
    dispatch,
    dispatchMetadata,
    refresh,
    close,
  }
}
