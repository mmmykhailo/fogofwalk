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
export class UniqueDistanceProjection {
  private readonly compute: (
    activities: ParsedActivity[]
  ) => Promise<Map<string, number>>
  private readonly save: (
    activities: ParsedActivity[],
    options: SaveUniqueDistancesOptions
  ) => Promise<UniqueDistanceSaveResult>
  private readonly events: UniqueDistanceProjectionEvents
  private readonly listeners = new Set<StatusListener>()
  private pending: LibrarySnapshot | null = null
  private running: Promise<void> | null = null
  private status: UniqueDistanceProjectionStatus = {
    state: "idle",
    activeRevision: null,
    queuedRevision: null,
    completedRevision: null,
    error: null,
  }

  constructor(
    dependencies: UniqueDistanceProjectionDependencies = {},
    events: UniqueDistanceProjectionEvents = {}
  ) {
    this.compute =
      dependencies.compute ??
      ((activities) => computeUniqueDistancesInWorker(activities))
    this.save =
      dependencies.save ??
      ((activities, options) => saveUniqueDistances(activities, options))
    this.events = events
  }

  getStatus(): UniqueDistanceProjectionStatus {
    return cloneStatus(this.status)
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => this.listeners.delete(listener)
  }

  /** Queue the newest committed library snapshot without blocking its caller. */
  schedule(snapshot: LibrarySnapshot): void {
    if (
      (this.status.activeRevision !== null &&
        snapshot.revision <= this.status.activeRevision) ||
      (this.pending !== null && snapshot.revision <= this.pending.revision) ||
      (this.status.state !== "failed" &&
        this.status.completedRevision !== null &&
        snapshot.revision <= this.status.completedRevision)
    )
      return
    this.pending = cloneSnapshot(snapshot)
    this.status.queuedRevision = snapshot.revision
    this.status.error = null
    this.emitStatus()
    this.startDrain()
  }

  /** Resolve once all currently queued projection work has settled. */
  async waitForIdle(): Promise<void> {
    while (this.running) await this.running
  }

  private startDrain(): void {
    if (this.running || !this.pending) return
    this.running = this.drain().finally(() => {
      this.running = null
      if (this.pending) {
        this.status.queuedRevision = this.pending.revision
        this.emitStatus()
        this.startDrain()
      } else {
        if (this.status.state !== "failed") this.status.state = "idle"
        this.status.activeRevision = null
        this.status.queuedRevision = null
        this.emitStatus()
      }
    })
    void this.running.catch(() => {})
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const snapshot = this.pending
      this.pending = null
      this.status.state = "running"
      this.status.activeRevision = snapshot.revision
      this.status.queuedRevision = null
      this.emitStatus()

      try {
        const distances = await this.compute(
          cloneActivities(snapshot.activities)
        )

        // A newer commit arrived while the worker was running. Do not spend
        // an IDB write on a result that is already obsolete.
        const queued = this.pending as LibrarySnapshot | null
        if (queued && queued.revision > snapshot.revision) continue

        const projected = snapshot.activities.map((activity) => ({
          ...activity,
          stats: {
            ...activity.stats,
            uniqueDistanceKm:
              distances.get(activity.id) ?? activity.stats.distanceKm,
          },
        }))
        const result = await this.save(projected, {
          libraryRevision: snapshot.revision,
        })
        if (result.status === "stale") continue
        if (result.status !== "saved") {
          this.fail(snapshot.revision, errorFromSaveResult(result))
          continue
        }
        this.status.completedRevision = result.libraryRevision
        this.status.error = null
        try {
          this.events.onComplete?.({
            revision: snapshot.revision,
            activities: cloneActivities(projected),
          })
        } catch {
          // A render projection consumer cannot invalidate a durable save.
        }
      } catch (error) {
        this.fail(snapshot.revision, error)
      } finally {
        this.status.activeRevision = null
        this.emitStatus()
      }
    }
  }

  private fail(revision: number, error: unknown): void {
    this.status.state = "failed"
    this.status.error = error
    const failure = { revision, error }
    try {
      this.events.onError?.(failure)
    } catch {
      // Observability must not stop the projection queue.
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    const next = this.getStatus()
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch {
        // One status consumer cannot strand projection work for the others.
      }
    }
  }
}
