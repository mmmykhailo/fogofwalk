import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { ActivityLibrary } from "./library"
import {
  ActivityLibraryConflictError,
  ActivityStorageError,
} from "./errors"
import {
  MemoryActivityLibraryRepository,
  applyLibraryCommand,
} from "./repository"

function activity(
  id: string,
  contentHash = `hash-${id}`
): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: null,
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

describe("activity library command repository", () => {
  test("deduplicates an import by content hash without advancing revision", () => {
    const first = activity("first", "same")
    const initial = { revision: 0, activities: [] as ParsedActivity[] }
    const added = applyLibraryCommand(initial, {
      type: "import",
      operationId: "op-1",
      activities: [first],
    })
    const duplicate = applyLibraryCommand(added.snapshot, {
      type: "import",
      operationId: "op-2",
      activities: [activity("second", "same")],
    })

    expect(added.snapshot.revision).toBe(1)
    expect(duplicate.snapshot.revision).toBe(1)
    expect(duplicate.change.duplicates).toEqual([
      {
        activityId: "second",
        contentHash: "same",
        existingActivityId: "first",
        reason: "content-hash",
      },
    ])
  })

  test("publishes one revisioned change after an atomic command", async () => {
    const repository = new MemoryActivityLibraryRepository()
    const library = new ActivityLibrary(repository)
    const events: number[] = []
    library.subscribe((snapshot, change) => {
      events.push(snapshot.revision)
      expect(change.fromRevision).toBe(0)
      expect(change.revision).toBe(1)
    })

    const result = await library.dispatch({
      type: "import",
      operationId: "import-1",
      activities: [activity("first")],
    })

    expect(result.snapshot.revision).toBe(1)
    expect(result.change.added.map((item) => item.id)).toEqual(["first"])
    expect(events).toEqual([1])
    expect(library.getSnapshot().activities[0]?.id).toBe("first")
    library.close()
  })

  test("retries a concurrent revision conflict without dropping the command", async () => {
    const repository = new MemoryActivityLibraryRepository([activity("first")], 1)
    const library = new ActivityLibrary(repository)
    await library.initialize()
    // Simulate another tab committing after this tab loaded its snapshot.
    await repository.commit(
      {
        type: "import",
        operationId: "other",
        activities: [activity("second")],
      },
      1
    )

    const result = await library.dispatch({
      type: "import",
      operationId: "local",
      activities: [activity("third")],
    })

    expect(result.snapshot.revision).toBe(3)
    expect(result.snapshot.activities.map((item) => item.id)).toEqual([
      "first",
      "second",
      "third",
    ])
    library.close()
  })

  test("does not convert a storage failure into a successful commit", async () => {
    const repository = new MemoryActivityLibraryRepository()
    repository.failNext(
      new ActivityStorageError("quota", "storage is full", {
        retryable: false,
      })
    )
    const library = new ActivityLibrary(repository)

    await expect(
      library.dispatch({
        type: "import",
        operationId: "failed",
        activities: [activity("first")],
      })
    ).rejects.toBeInstanceOf(ActivityStorageError)
    expect((await repository.load()).activities).toHaveLength(0)
    library.close()
  })

  test("reports stale expected revisions explicitly", async () => {
    const repository = new MemoryActivityLibraryRepository([activity("first")], 4)
    await expect(
      repository.commit(
        {
          type: "import",
          operationId: "stale",
          activities: [activity("second")],
        },
        3
      )
    ).rejects.toBeInstanceOf(ActivityLibraryConflictError)
  })
})
