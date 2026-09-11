import { describe, expect, test } from "bun:test"
import type {
  ActivityMeta,
  ActivityUploadPayload,
  ManifestPage,
} from "~shared/api"
import { createActivityLibrary } from "~/lib/activities/library"
import { createMemoryActivityLibraryRepository } from "~/lib/activities/repository"
import type { SyncState } from "~/lib/storage"
import type { ParsedActivity } from "~/types/activities"
import { MemorySyncRepository } from "./repository"
import { ActivitySyncExecutor, SyncExecutorProtocolError } from "./executor"
import { SyncTransportError, type SyncTransport } from "./transport"
import {
  createActivityDeleteOutboxItem,
  createActivityUploadOutboxItem,
} from "./activityEffects"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

function activity(id: string, contentHash: string): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: 0,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    contentHash,
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

function meta(contentHash: string, updatedAt = 1): ActivityMeta {
  return {
    contentHash,
    name: `${contentHash.slice(0, 1)}.gpx`,
    isPublic: false,
    format: "gpx",
    startedAtMs: 0,
    distanceKm: 1,
    pointCount: 2,
    sizeBytes: 100,
    updatedAt,
    durationMs: null,
    movingTimeMs: null,
    elevationGainM: 0,
    avgMovingSpeedKmh: null,
  }
}

function payload(): ActivityUploadPayload {
  return {
    name: "remote.gpx",
    startedAtMs: 0,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

function transportFor(
  pages: Map<number, ManifestPage>,
  options: {
    download?: (contentHash: string) => Promise<ActivityUploadPayload>
    upload?: (activity: ParsedActivity) => Promise<void>
  } = {}
): SyncTransport {
  return {
    async fetchActivityManifest(since) {
      const page = pages.get(since)
      if (!page) throw new Error(`unexpected manifest cursor ${since}`)
      return page
    },
    async downloadActivity(contentHash) {
      const body = options.download
        ? await options.download(contentHash)
        : payload()
      return { payload: body }
    },
    async uploadActivity(value) {
      await options.upload?.(value)
    },
    async deleteActivity() {
      return 1
    },
  }
}

async function createExecutor(
  initial: ParsedActivity[],
  transport: SyncTransport,
  options: {
    now?: () => number
    random?: () => number
    state?: SyncState
  } = {}
) {
  const library = createActivityLibrary(
    createMemoryActivityLibraryRepository(initial)
  )
  const repository = new MemorySyncRepository({ now: options.now })
  if (options.state) await repository.saveState(options.state)
  const executor = new ActivitySyncExecutor({
    repository,
    library,
    transport,
    owner: "test-executor",
    random: options.random ?? (() => 0),
    now: options.now,
  })
  return { executor, library, repository }
}

describe("ActivitySyncExecutor", () => {
  test("downloads one page, publishes one library change, and completes its outbox item", async () => {
    const events: number[] = []
    const { executor, library, repository } = await createExecutor(
      [],
      transportFor(
        new Map([
          [
            0,
            {
              activities: [meta(HASH_A)],
              deletions: [],
              cursor: 7,
              hasMore: false,
            },
          ],
        ])
      )
    )
    library.subscribe((snapshot) => events.push(snapshot.revision))

    const result = await executor.run()

    expect(result.state.cursor).toBe(7)
    expect(result.downloadedCount).toBe(1)
    expect(result.failures).toEqual([])
    expect(events).toEqual([1])
    expect(library.getSnapshot().activities).toHaveLength(1)
    expect(result.state.serverHashes).toEqual([HASH_A])
    expect(await repository.loadOutbox()).toMatchObject([
      { operation: "download", status: "complete" },
    ])
  })

  test("drains a durable local upload even when the manifest has no activity row", async () => {
    const local = activity("local-a", HASH_A)
    let uploads = 0
    const { executor, library, repository } = await createExecutor(
      [local],
      transportFor(
        new Map([
          [0, { activities: [], deletions: [], cursor: 1, hasMore: false }],
        ]),
        {
          upload: async () => {
            uploads++
          },
        }
      )
    )
    await repository.enqueueOutbox(
      createActivityUploadOutboxItem(local, "import-1", 1)!
    )

    const result = await executor.run()

    expect(uploads).toBe(1)
    expect(result.state.cursor).toBe(1)
    expect(result.state.serverHashes).toEqual([HASH_A])
    expect(result.failures).toEqual([])
    expect(await repository.loadOutbox()).toMatchObject([
      { operation: "upload", status: "complete" },
    ])
    expect(library.getSnapshot().activities).toHaveLength(1)
  })

  test("drains a durable local deletion and remembers the returned tombstone", async () => {
    const local = activity("local-a", HASH_A)
    let deletions = 0
    const { executor, repository } = await createExecutor(
      [],
      transportFor(
        new Map([
          [0, { activities: [], deletions: [], cursor: 1, hasMore: false }],
        ])
      ),
      { now: () => 10 }
    )
    const item = createActivityDeleteOutboxItem(local, "delete-1", 1)!
    await repository.enqueueOutbox(item)
    const originalTransport = transportFor(
      new Map([
        [0, { activities: [], deletions: [], cursor: 1, hasMore: false }],
      ])
    )
    const deleteTransport: SyncTransport = {
      ...originalTransport,
      async deleteActivity() {
        deletions++
        return 9
      },
    }
    const second = new ActivitySyncExecutor({
      repository,
      library: (await createExecutor([], deleteTransport)).library,
      transport: deleteTransport,
      owner: "test-delete",
      now: () => 10,
      random: () => 0,
    })

    const result = await second.run()

    expect(deletions).toBe(1)
    expect(result.state.serverHashes).toEqual([])
    expect(result.state.appliedTombstones).toEqual({ [HASH_A]: 9 })
    expect(await repository.loadOutbox()).toMatchObject([
      { operation: "delete", status: "complete" },
    ])
  })

  test("holds the cursor after a failed remote body and resumes after retry time", async () => {
    let now = 1_000
    let shouldFail = true
    const { executor, library, repository } = await createExecutor(
      [],
      transportFor(
        new Map([
          [
            0,
            {
              activities: [meta(HASH_A)],
              deletions: [],
              cursor: 7,
              hasMore: false,
            },
          ],
        ]),
        {
          download: async () => {
            if (shouldFail) throw new Error("temporary network failure")
            return payload()
          },
        }
      ),
      { now: () => now }
    )

    const first = await executor.run()
    expect(first.state.cursor).toBe(0)
    expect(first.cursorHeld).toBe(true)
    expect(first.failures[0]).toMatchObject({ retryable: true })
    expect(library.getSnapshot().activities).toHaveLength(0)
    expect((await repository.loadOutbox())[0]).toMatchObject({
      status: "retryable",
    })

    now = 5_000
    shouldFail = false
    const second = await executor.run()
    expect(second.state.cursor).toBe(7)
    expect(second.downloadedCount).toBe(1)
    expect(second.failures).toEqual([])
    expect((await repository.loadOutbox())[0]).toMatchObject({
      status: "complete",
      attempts: 2,
    })
  })

  test("commits safe siblings while holding the cursor for a failed sibling", async () => {
    const { executor, library, repository } = await createExecutor(
      [],
      transportFor(
        new Map([
          [
            0,
            {
              activities: [meta(HASH_A), meta(HASH_B)],
              deletions: [],
              cursor: 2,
              hasMore: false,
            },
          ],
        ]),
        {
          download: async (contentHash) => {
            if (contentHash === HASH_B) throw new Error("body unavailable")
            return payload()
          },
        }
      )
    )

    const result = await executor.run()

    expect(result.state.cursor).toBe(0)
    expect(result.cursorHeld).toBe(true)
    expect(library.getSnapshot().activities).toHaveLength(1)
    const outbox = await repository.loadOutbox()
    expect(outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "download", status: "complete" }),
        expect.objectContaining({ operation: "download", status: "retryable" }),
      ])
    )
  })

  test("treats an over-size local upload as permanent without claiming server success", async () => {
    const local = activity("local-a", HASH_A)
    const { executor, repository } = await createExecutor(
      [local],
      transportFor(
        new Map([
          [0, { activities: [], deletions: [], cursor: 1, hasMore: false }],
        ]),
        {
          upload: async () => {
            throw new SyncTransportError(
              "payload-too-large",
              "That activity is too large to upload."
            )
          },
        }
      )
    )

    const result = await executor.run()

    expect(result.state.cursor).toBe(1)
    expect(result.state.serverHashes).not.toContain(HASH_A)
    expect(result.failures).toMatchObject([
      { operation: "upload", retryable: false },
    ])
    expect(await repository.loadOutbox()).toMatchObject([
      {
        operation: "upload",
        status: "permanent",
        lastFailure: { code: "payload-too-large" },
      },
    ])
  })

  test("applies a remote tombstone through the library and advances its cursor", async () => {
    const local = activity("local-a", HASH_A)
    const { executor, library, repository } = await createExecutor(
      [local],
      transportFor(
        new Map([
          [
            4,
            {
              activities: [],
              deletions: [{ contentHash: HASH_A, deletedAt: 5 }],
              cursor: 6,
              hasMore: false,
            },
          ],
        ])
      ),
      {
        state: {
          cursor: 4,
          lastSyncAt: 4,
          serverHashes: [HASH_A],
        },
      }
    )

    const result = await executor.run()

    expect(result.state.cursor).toBe(6)
    expect(result.deletedIds).toEqual(["local-a"])
    expect(library.getSnapshot().activities).toEqual([])
    expect(await repository.loadOutbox()).toMatchObject([
      { operation: "delete", status: "complete" },
    ])
  })

  test("publishes a remote metadata update in one library command", async () => {
    const local = activity("local-a", HASH_A)
    const events: number[] = []
    const { executor, library, repository } = await createExecutor(
      [local],
      transportFor(
        new Map([
          [
            4,
            {
              activities: [meta(HASH_A, 5)],
              deletions: [],
              cursor: 6,
              hasMore: false,
            },
          ],
        ])
      ),
      {
        state: {
          cursor: 4,
          lastSyncAt: 4,
          serverHashes: [HASH_A],
        },
      }
    )
    library.subscribe((snapshot) => events.push(snapshot.revision))

    const result = await executor.run()

    expect(result.state.cursor).toBe(6)
    expect(result.updatedCount).toBe(1)
    expect(events).toEqual([1])
    expect(library.getSnapshot().activities[0]?.name).toBe("a.gpx")
    expect(await repository.loadOutbox()).toMatchObject([
      { operation: "metadata", status: "complete" },
    ])
  })

  test("rejects a non-advancing page before creating effects", async () => {
    const { executor, repository } = await createExecutor(
      [],
      transportFor(
        new Map([
          [0, { activities: [], deletions: [], cursor: 0, hasMore: true }],
        ])
      )
    )

    await expect(executor.run()).rejects.toBeInstanceOf(
      SyncExecutorProtocolError
    )
    expect(await repository.loadState()).toBeNull()
    expect(await repository.loadOutbox()).toEqual([])
  })
})
