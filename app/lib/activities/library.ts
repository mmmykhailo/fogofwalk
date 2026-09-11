import { ActivityLibraryConflictError, ActivityStorageError } from "./errors"
import {
  IndexedDbActivityLibraryRepository,
  type ActivityLibraryCommitOptions,
  type ActivityLibraryRepository,
} from "./repository"
import type {
  LibraryCommand,
  LibraryCommit,
  LibraryChange,
  LibraryListener,
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
    activities: Object.freeze(
      (activities as unknown[]).map((activity) => Object.freeze(activity))
    ) as LibrarySnapshot["activities"],
  }
}

function cloneChange(change: LibraryChange): LibraryChange {
  if (typeof structuredClone === "function") return structuredClone(change)
  return JSON.parse(JSON.stringify(change)) as LibraryChange
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
  return cloneChange({
    operationId: `external:${next.revision}`,
    fromRevision: previous.revision,
    revision: next.revision,
    added: [...added],
    updated: [...updated],
    removed: [...removed],
    duplicates: [],
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
export class ActivityLibrary {
  private readonly repository: ActivityLibraryRepository
  private snapshot: LibrarySnapshot | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<LibraryListener>()
  private channel: BroadcastChannel | null = null
  private refreshPromise: Promise<void> | null = null

  constructor(
    repository: ActivityLibraryRepository = new IndexedDbActivityLibraryRepository()
  ) {
    this.repository = repository
    if (
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data
        if (
          !data ||
          typeof data !== "object" ||
          typeof (data as { revision?: unknown }).revision !== "number"
        ) {
          return
        }
        const revision = (data as { revision: number }).revision
        if ((this.snapshot?.revision ?? -1) < revision) void this.refresh()
      }
    }
  }

  async initialize(): Promise<LibrarySnapshot> {
    return this.enqueue(async () => {
      if (!this.snapshot)
        this.snapshot = cloneSnapshot(await this.repository.load())
      return cloneSnapshot(this.snapshot)
    })
  }

  getSnapshot(): LibrarySnapshot {
    if (!this.snapshot) {
      throw new ActivityStorageError(
        "unavailable",
        "The activity library has not finished loading."
      )
    }
    return cloneSnapshot(this.snapshot)
  }

  subscribe(listener: LibraryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispatch(
    command: LibraryCommand,
    options: ActivityLibraryCommitOptions = {}
  ): Promise<LibraryCommit> {
    return this.enqueue(async () => {
      if (!this.snapshot)
        this.snapshot = cloneSnapshot(await this.repository.load())

      let attempt = 0
      while (attempt < 2) {
        attempt++
        const base = this.snapshot
        const commit = await this.withWriteLock(() =>
          this.repository.commit(command, base.revision, options)
        ).catch(async (error: unknown) => {
          if (
            !(error instanceof ActivityLibraryConflictError) ||
            attempt >= 2
          ) {
            throw error
          }
          this.snapshot = cloneSnapshot(await this.repository.load())
          return null
        })
        if (!commit) continue

        this.snapshot = cloneSnapshot(commit.snapshot)
        // `change` is already detached by the repository. The local object is
        // kept separate from the returned commit so listeners cannot mutate it.
        for (const listener of this.listeners) {
          listener(cloneSnapshot(commit.snapshot), cloneChange(commit.change))
        }
        this.channel?.postMessage({ revision: commit.snapshot.revision })
        return {
          snapshot: cloneSnapshot(commit.snapshot),
          change: cloneChange(commit.change),
        }
      }
      throw new Error("Activity library conflict did not resolve")
    })
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.enqueue(async () => {
      const next = cloneSnapshot(await this.repository.load())
      if (!this.snapshot || next.revision > this.snapshot.revision) {
        const previous = this.snapshot
        this.snapshot = next
        if (previous) {
          const change = changeBetween(previous, next)
          for (const listener of this.listeners) {
            listener(cloneSnapshot(next), cloneChange(change))
          }
        }
      }
    }).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  close(): void {
    this.channel?.close()
    this.channel = null
    this.listeners.clear()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const locks = safeNavigatorLocks()
    if (!locks) return operation()
    return locks.request(LOCK_NAME, { mode: "exclusive" }, operation)
  }
}

export function createActivityLibrary(
  repository?: ActivityLibraryRepository
): ActivityLibrary {
  return new ActivityLibrary(repository)
}
