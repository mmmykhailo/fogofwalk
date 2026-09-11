import type { ParsedActivity } from "~/types/activities"
import type { LibrarySnapshot } from "~/lib/activities/libraryEvents"
import {
  saveUniqueDistances,
  type SaveUniqueDistancesOptions,
  type UniqueDistanceSaveResult,
} from "~/lib/storage"
import { computeUniqueDistancesInWorker } from "~/lib/uniqueDistanceWorkerClient"

export type UniqueDistanceProjectionState = "idle" | "running" | "failed"

export interface UniqueDistanceProjectionStatus {
  state: UniqueDistanceProjectionState
  activeRevision: number | null
  queuedRevision: number | null
  completedRevision: number | null
  error: unknown | null
}

export interface UniqueDistanceProjectionError {
  revision: number
  error: unknown
}

export interface UniqueDistanceProjectionEvents {
  onError?: (failure: UniqueDistanceProjectionError) => void
  onComplete?: (result: {
    revision: number
    activities: ParsedActivity[]
  }) => void
}

export interface UniqueDistanceProjectionDependencies {
  compute?: (activities: ParsedActivity[]) => Promise<Map<string, number>>
  save?: (
    activities: ParsedActivity[],
    options: SaveUniqueDistancesOptions
  ) => Promise<UniqueDistanceSaveResult>
}

type StatusListener = (status: UniqueDistanceProjectionStatus) => void

function cloneActivities(
  activities: readonly ParsedActivity[]
): ParsedActivity[] {
  if (typeof structuredClone === "function") {
    return structuredClone([...activities])
  }
  return JSON.parse(JSON.stringify(activities)) as ParsedActivity[]
}

function cloneSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    revision: snapshot.revision,
    activities: cloneActivities(snapshot.activities),
  }
}

function cloneStatus(
  status: UniqueDistanceProjectionStatus
): UniqueDistanceProjectionStatus {
  return { ...status }
}

function errorFromSaveResult(result: UniqueDistanceSaveResult): unknown {
  if (result.status === "unavailable" || result.status === "failed") {
    return result.error
  }
  return new Error(`Unique-distance projection was not saved: ${result.status}`)
}

/**
 * Computes unique-distance values for committed library revisions in order.
 *
 * A newer snapshot replaces the queued work. Results are persisted only with
 * the revision they were computed from; storage performs the final atomic
 * library-meta check so a projection can never backdate a newer commit.
 */
export interface UniqueDistanceProjection {
  getStatus(): UniqueDistanceProjectionStatus
  subscribe(listener: StatusListener): () => void
  schedule(snapshot: LibrarySnapshot): void
  waitForIdle(): Promise<void>
}

export function createUniqueDistanceProjection(
  dependencies: UniqueDistanceProjectionDependencies = {},
  events: UniqueDistanceProjectionEvents = {}
): UniqueDistanceProjection {
  const compute =
    dependencies.compute ??
    ((activities: ParsedActivity[]) => computeUniqueDistancesInWorker(activities))
  const save =
    dependencies.save ??
    ((activities: ParsedActivity[], options: SaveUniqueDistancesOptions) =>
      saveUniqueDistances(activities, options))
  const listeners = new Set<StatusListener>()
  let pending: LibrarySnapshot | null = null
  let running: Promise<void> | null = null
  let status: UniqueDistanceProjectionStatus = {
    state: "idle",
    activeRevision: null,
    queuedRevision: null,
    completedRevision: null,
    error: null,
  }

  function getStatus(): UniqueDistanceProjectionStatus {
    return cloneStatus(status)
  }

  function emitStatus(): void {
    const next = getStatus()
    for (const listener of listeners) {
      try {
        listener(next)
      } catch {
        // One status consumer cannot strand projection work for the others.
      }
    }
  }

  function subscribe(listener: StatusListener): () => void {
    listeners.add(listener)
    listener(getStatus())
    return () => listeners.delete(listener)
  }

  function fail(revision: number, error: unknown): void {
    status = { ...status, state: "failed", error }
    const failure = { revision, error }
    try {
      events.onError?.(failure)
    } catch {
      // Observability must not stop the projection queue.
    }
    emitStatus()
  }

  async function drain(): Promise<void> {
    while (pending) {
      const snapshot = pending
      pending = null
      status = {
        ...status,
        state: "running",
        activeRevision: snapshot.revision,
        queuedRevision: null,
      }
      emitStatus()

      try {
        const distances = await compute(cloneActivities(snapshot.activities))

        // A newer commit arrived while the worker was running. Do not spend
        // an IDB write on a result that is already obsolete.
        const queued = pending as LibrarySnapshot | null
        if (queued && queued.revision > snapshot.revision) continue

        const projected = snapshot.activities.map((activity) => ({
          ...activity,
          stats: {
            ...activity.stats,
            uniqueDistanceKm:
              distances.get(activity.id) ?? activity.stats.distanceKm,
          },
        }))
        const result = await save(projected, {
          libraryRevision: snapshot.revision,
        })
        if (result.status === "stale") continue
        if (result.status !== "saved") {
          fail(snapshot.revision, errorFromSaveResult(result))
          continue
        }
        status = {
          ...status,
          completedRevision: result.libraryRevision,
          error: null,
        }
        try {
          events.onComplete?.({
            revision: snapshot.revision,
            activities: cloneActivities(projected),
          })
        } catch {
          // A render projection consumer cannot invalidate a durable save.
        }
      } catch (error) {
        fail(snapshot.revision, error)
      } finally {
        status = { ...status, activeRevision: null }
        emitStatus()
      }
    }
  }

  function startDrain(): void {
    if (running || !pending) return
    running = drain().finally(() => {
      running = null
      if (pending) {
        status = { ...status, queuedRevision: pending.revision }
        emitStatus()
        startDrain()
      } else {
        status = {
          ...status,
          state: status.state === "failed" ? "failed" : "idle",
          activeRevision: null,
          queuedRevision: null,
        }
        emitStatus()
      }
    })
    void running.catch(() => {})
  }

  function schedule(snapshot: LibrarySnapshot): void {
    if (
      (status.activeRevision !== null &&
        snapshot.revision <= status.activeRevision) ||
      (pending !== null && snapshot.revision <= pending.revision) ||
      (status.state !== "failed" &&
        status.completedRevision !== null &&
        snapshot.revision <= status.completedRevision)
    )
      return
    pending = cloneSnapshot(snapshot)
    status = {
      ...status,
      queuedRevision: snapshot.revision,
      error: null,
    }
    emitStatus()
    startDrain()
  }

  async function waitForIdle(): Promise<void> {
    while (running) await running
  }

  return { getStatus, subscribe, schedule, waitForIdle }
}
