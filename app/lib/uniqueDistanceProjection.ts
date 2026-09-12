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
  activeCoverageRevision: number | null
  queuedCoverageRevision: number | null
  completedCoverageRevision: number | null
  error: unknown | null
}

export interface UniqueDistanceProjectionError {
  coverageRevision: number
  error: unknown
}

export interface UniqueDistanceProjectionEvents {
  onError?: (failure: UniqueDistanceProjectionError) => void
  onComplete?: (result: {
    coverageRevision: number
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
    coverageRevision: snapshot.coverageRevision,
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
 * Computes unique-distance values for committed coverage revisions in order.
 *
 * A newer snapshot replaces the queued work. Results are persisted only with
 * the coverage revision they were computed from; storage performs the final atomic
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
    ((activities: ParsedActivity[]) =>
      computeUniqueDistancesInWorker(activities))
  const save =
    dependencies.save ??
    ((activities: ParsedActivity[], options: SaveUniqueDistancesOptions) =>
      saveUniqueDistances(activities, options))
  const listeners = new Set<StatusListener>()
  let pending: LibrarySnapshot | null = null
  let running: Promise<void> | null = null
  let status: UniqueDistanceProjectionStatus = {
    state: "idle",
    activeCoverageRevision: null,
    queuedCoverageRevision: null,
    completedCoverageRevision: null,
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

  function fail(coverageRevision: number, error: unknown): void {
    status = { ...status, state: "failed", error }
    const failure = { coverageRevision, error }
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
        activeCoverageRevision: snapshot.coverageRevision,
        queuedCoverageRevision: null,
      }
      emitStatus()

      try {
        const distances = await compute(cloneActivities(snapshot.activities))

        // A newer commit arrived while the worker was running. Do not spend
        // an IDB write on a result that is already obsolete.
        const queued = pending as LibrarySnapshot | null
        if (queued && queued.coverageRevision > snapshot.coverageRevision)
          continue

        const projected = snapshot.activities.map((activity) => ({
          ...activity,
          stats: {
            ...activity.stats,
            uniqueDistanceKm:
              distances.get(activity.id) ?? activity.stats.distanceKm,
          },
        }))
        const result = await save(projected, {
          coverageRevision: snapshot.coverageRevision,
        })
        if (result.status === "stale") continue
        if (result.status !== "saved") {
          fail(snapshot.coverageRevision, errorFromSaveResult(result))
          continue
        }
        status = {
          ...status,
          completedCoverageRevision: result.coverageRevision,
          error: null,
        }
        try {
          events.onComplete?.({
            coverageRevision: snapshot.coverageRevision,
            activities: cloneActivities(projected),
          })
        } catch {
          // A render projection consumer cannot invalidate a durable save.
        }
      } catch (error) {
        fail(snapshot.coverageRevision, error)
      } finally {
        status = { ...status, activeCoverageRevision: null }
        emitStatus()
      }
    }
  }

  function startDrain(): void {
    if (running || !pending) return
    running = drain().finally(() => {
      running = null
      if (pending) {
        status = {
          ...status,
          queuedCoverageRevision: pending.coverageRevision,
        }
        emitStatus()
        startDrain()
      } else {
        status = {
          ...status,
          state: status.state === "failed" ? "failed" : "idle",
          activeCoverageRevision: null,
          queuedCoverageRevision: null,
        }
        emitStatus()
      }
    })
    void running.catch(() => {})
  }

  function schedule(snapshot: LibrarySnapshot): void {
    if (
      (status.activeCoverageRevision !== null &&
        snapshot.coverageRevision <= status.activeCoverageRevision) ||
      (pending !== null &&
        snapshot.coverageRevision <= pending.coverageRevision) ||
      (status.state !== "failed" &&
        status.completedCoverageRevision !== null &&
        snapshot.coverageRevision <= status.completedCoverageRevision)
    )
      return
    pending = cloneSnapshot(snapshot)
    status = {
      ...status,
      queuedCoverageRevision: snapshot.coverageRevision,
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
