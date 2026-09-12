import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { createActivityLibrary } from "./library"
import {
  createActivityStorageError,
  isActivityLibraryConflictError,
  isActivityStorageError,
} from "./errors"
import {
  applyLibraryCommand,
  createMemoryActivityLibraryRepository,
} from "./repository"

function activity(id: string, contentHash = `hash-${id}`): ParsedActivity {
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
    const initial = {
      revision: 0,
      coverageRevision: 0,
      activities: [] as ParsedActivity[],
    }
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
    expect(added.snapshot.coverageRevision).toBe(1)
    expect(duplicate.snapshot.revision).toBe(1)
    expect(duplicate.snapshot.coverageRevision).toBe(1)
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
    const repository = createMemoryActivityLibraryRepository()
    const library = createActivityLibrary(repository)
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

  test("commits a library mutation and its outbox effect together", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const library = createActivityLibrary(repository)

    const result = await library.dispatch(
      {
        type: "import",
        operationId: "import-with-outbox",
        activities: [activity("first")],
      },
      {
        outbox: [
          {
            dedupeKey: "activity:upload:import-with-outbox",
            operation: "upload",
            payload: { kind: "upload", activityId: "first" },
          },
        ],
      }
    )

    expect(result.snapshot.activities).toHaveLength(1)
    expect(repository.getOutbox()).toEqual([
      expect.objectContaining({
        dedupeKey: "activity:upload:import-with-outbox",
        operation: "upload",
        status: "pending",
        attempts: 0,
      }),
    ])
    library.close()
  })

  test("[L-014] derives activity effects from the committed change and revision", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const library = createActivityLibrary(repository)
    const first = activity("first", "hash-first")

    await library.dispatch(
      {
        type: "import",
        operationId: "authoritative-import",
        activities: [first],
      },
      {
        outbox: (commit) =>
          commit.change.added.flatMap((item) => [
            {
              dedupeKey: "activity:authoritative:first",
              operation: "upload" as const,
              payload: {
                kind: "upload",
                activityId: item.id,
                contentHash: item.contentHash,
                libraryRevision: commit.snapshot.revision - 1,
              },
            },
          ]),
      }
    )

    expect(repository.getOutbox()[0]?.payload).toMatchObject({
      activityId: "first",
      libraryRevision: 1,
    })

    await library.dispatch(
      {
        type: "import",
        operationId: "duplicate-import",
        activities: [activity("duplicate", "hash-first")],
      },
      {
        outbox: (commit) => [
          {
            dedupeKey: "activity:authoritative:duplicate",
            operation: "upload",
            payload: {
              kind: "upload",
              activityId: "duplicate",
              contentHash: "hash-first",
              libraryRevision: commit.snapshot.revision,
            },
          },
        ],
      }
    )

    expect(repository.getOutbox()).toHaveLength(1)
    library.close()
  })

  test("[L-014] does not persist a delete effect for a delete no-op", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const library = createActivityLibrary(repository)
    const missing = activity("missing")

    await library.dispatch(
      { type: "delete", operationId: "delete-no-op", activityId: missing.id },
      {
        outbox: (commit) => [
          {
            dedupeKey: "activity:authoritative:missing",
            operation: "delete",
            payload: {
              kind: "local-delete",
              activityId: missing.id,
              contentHash: missing.contentHash,
              libraryRevision: commit.snapshot.revision,
            },
          },
        ],
      }
    )

    expect(repository.getOutbox()).toHaveLength(0)
    library.close()
  })

  test("retries a concurrent revision conflict without dropping the command", async () => {
    const repository = createMemoryActivityLibraryRepository(
      [activity("first")],
      1
    )
    const library = createActivityLibrary(repository)
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
    const repository = createMemoryActivityLibraryRepository()
    repository.failNext(
      createActivityStorageError("quota", "storage is full", {
        retryable: false,
      })
    )
    const library = createActivityLibrary(repository)

    const failure = await library
      .dispatch({
        type: "import",
        operationId: "failed",
        activities: [activity("first")],
      })
      .catch((error: unknown) => error)
    expect(isActivityStorageError(failure)).toBe(true)
    expect((await repository.load()).activities).toHaveLength(0)
    library.close()
  })

  test("reports stale expected revisions explicitly", async () => {
    const repository = createMemoryActivityLibraryRepository(
      [activity("first")],
      4
    )
    const failure = await repository
      .commit(
        {
          type: "import",
          operationId: "stale",
          activities: [activity("second")],
        },
        3
      )
      .catch((error: unknown) => error)
    expect(isActivityLibraryConflictError(failure)).toBe(true)
  })

  test("applies remote metadata by hash or id without needless revisions", async () => {
    const repository = createMemoryActivityLibraryRepository([
      activity("local"),
    ])
    const library = createActivityLibrary(repository)
    await library.initialize()

    const byHash = await library.dispatch({
      type: "applyRemote",
      operationId: "remote-hash",
      changes: [
        {
          type: "upsert",
          activity: { ...activity("remote", "hash-local"), name: "renamed" },
        },
      ],
    })
    expect(byHash.snapshot.revision).toBe(1)
    expect(byHash.snapshot.activities[0]).toMatchObject({
      id: "local",
      name: "renamed",
    })

    const noOp = await library.dispatch({
      type: "applyRemote",
      operationId: "remote-noop",
      changes: [{ type: "upsert", activity: byHash.snapshot.activities[0]! }],
    })
    expect(noOp.snapshot.revision).toBe(1)
    expect(noOp.change.updated).toHaveLength(0)
  })

  test("keeps metadata revisions separate from coverage revisions", () => {
    const first = activity("local")
    const imported = applyLibraryCommand(
      { revision: 0, coverageRevision: 0, activities: [] },
      { type: "import", operationId: "import", activities: [first] }
    )

    const metadata = applyLibraryCommand(imported.snapshot, {
      type: "updateMetadata",
      operationId: "metadata",
      patches: [{ id: first.id, isPublic: true, activityType: "walking" }],
    })

    expect(metadata.snapshot.revision).toBe(2)
    expect(metadata.snapshot.coverageRevision).toBe(1)
    expect(metadata.change.domains).toEqual({
      membership: false,
      geometry: false,
      metadata: true,
      statistics: false,
    })
    expect(metadata.snapshot.activities[0]).toMatchObject({
      id: first.id,
      isPublic: true,
      activityType: "walking",
    })

    const noOp = applyLibraryCommand(metadata.snapshot, {
      type: "updateMetadata",
      operationId: "metadata-no-op",
      patches: [{ id: first.id, isPublic: true }],
    })
    expect(noOp.snapshot.revision).toBe(2)
    expect(noOp.snapshot.coverageRevision).toBe(1)
    expect(noOp.change.domains).toEqual({
      membership: false,
      geometry: false,
      metadata: false,
      statistics: false,
    })
  })

  test("rejects geometry fields and duplicate metadata targets", () => {
    expect(() =>
      applyLibraryCommand(
        { revision: 0, coverageRevision: 0, activities: [] },
        {
          type: "updateMetadata",
          operationId: "invalid",
          patches: [
            {
              id: "one",
              coordinates: [] as never,
            } as never,
          ],
        }
      )
    ).toThrow()
    expect(() =>
      applyLibraryCommand(
        { revision: 0, coverageRevision: 0, activities: [] },
        {
          type: "updateMetadata",
          operationId: "duplicate",
          patches: [{ id: "one", isPublic: true }, { id: "one", isPublic: false }],
        }
      )
    ).toThrow()
  })

  test("refresh publishes a newer repository snapshot to listeners", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const library = createActivityLibrary(repository)
    await library.initialize()
    const seen: number[] = []
    library.subscribe((snapshot) => seen.push(snapshot.revision))

    const otherTab = createActivityLibrary(repository)
    await otherTab.dispatch({
      type: "import",
      operationId: "other-tab",
      activities: [activity("remote")],
    })
    await library.refresh()

    expect(seen).toEqual([1])
    expect(library.getSnapshot().activities).toHaveLength(1)
  })
})
