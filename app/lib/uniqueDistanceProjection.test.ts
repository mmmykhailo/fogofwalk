import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import type { LibrarySnapshot } from "~/lib/activities/libraryEvents"
import { areUniqueDistancesCurrent } from "~/lib/storage"
import {
  createUniqueDistanceProjection,
  type UniqueDistanceProjectionStatus,
} from "./uniqueDistanceProjection"

function activity(id: string): ParsedActivity {
  return {
    id,
    name: id,
    startedAtMs: null,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
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

function snapshot(
  revision: number,
  activities: ParsedActivity[]
): LibrarySnapshot {
  return { revision, coverageRevision: revision, activities }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for projection state")
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe("UniqueDistanceProjection", () => {
  test("keys the projection marker by revision and activity identity", () => {
    const activities = [activity("one"), activity("two")]
    const state = {
      version: 3,
      coverageRevision: 12,
      activityIds: ["two", "one"],
    }

    expect(areUniqueDistancesCurrent(activities, state, 12)).toBe(true)
    expect(areUniqueDistancesCurrent(activities, state, 11)).toBe(false)
    expect(
      areUniqueDistancesCurrent(
        [activities[0]!],
        { ...state, activityIds: ["missing"] },
        12
      )
    ).toBe(false)
  })

  test("coalesces newer revisions and saves only the newest result", async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const computedIds: string[][] = []
    const saved: Array<{ revision: number; activities: ParsedActivity[] }> = []
    let computeCount = 0
    const projection = createUniqueDistanceProjection({
      compute: async (activities) => {
        computedIds.push(activities.map(({ id }) => id))
        computeCount++
        if (computeCount === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        return new Map(activities.map(({ id }) => [id, id === "new" ? 9 : 3]))
      },
      save: async (activities, options) => {
        saved.push({
          revision: options.coverageRevision!,
          activities,
        })
        return {
          status: "saved",
          coverageRevision: options.coverageRevision!,
        }
      },
    })

    projection.schedule(snapshot(1, [activity("old")]))
    await firstStarted.promise
    projection.schedule(snapshot(2, [activity("old"), activity("middle")]))
    projection.schedule(
      snapshot(3, [activity("old"), activity("middle"), activity("new")])
    )
    releaseFirst.resolve()
    await projection.waitForIdle()

    expect(computedIds).toEqual([["old"], ["old", "middle", "new"]])
    expect(saved).toHaveLength(1)
    expect(saved[0]?.revision).toBe(3)
    expect(
      saved[0]?.activities.find(({ id }) => id === "new")?.stats
        .uniqueDistanceKm
    ).toBe(9)
    expect(projection.getStatus()).toMatchObject({
      state: "idle",
      activeCoverageRevision: null,
      queuedCoverageRevision: null,
      completedCoverageRevision: 3,
      error: null,
    } satisfies Partial<UniqueDistanceProjectionStatus>)
  })

  test("does not treat a stale atomic save as a projection failure", async () => {
    const errors: unknown[] = []
    const projection = createUniqueDistanceProjection(
      {
        compute: async () => new Map([["one", 2]]),
        save: async (_, options) => ({
          status: "stale",
          expectedCoverageRevision: options.coverageRevision!,
          actualCoverageRevision: options.coverageRevision! + 1,
        }),
      },
      { onError: ({ error }) => errors.push(error) }
    )

    projection.schedule(snapshot(4, [activity("one")]))
    await projection.waitForIdle()

    expect(errors).toEqual([])
    expect(projection.getStatus()).toMatchObject({
      state: "idle",
      completedCoverageRevision: null,
      error: null,
    })
  })

  test("keeps a recoverable failure status and reports the revision", async () => {
    const failures: Array<{ coverageRevision: number; error: unknown }> = []
    const projection = createUniqueDistanceProjection(
      {
        compute: async () => {
          throw new Error("worker unavailable")
        },
      },
      { onError: (failure) => failures.push(failure) }
    )

    projection.schedule(snapshot(8, [activity("one")]))
    await projection.waitForIdle()

    expect(failures).toHaveLength(1)
    expect(failures[0]?.coverageRevision).toBe(8)
    expect(projection.getStatus()).toMatchObject({
      state: "failed",
      activeCoverageRevision: null,
      queuedCoverageRevision: null,
      error: expect.any(Error),
    })

    projection.schedule(snapshot(9, [activity("one")]))
    await waitFor(() => projection.getStatus().state === "failed")
    await projection.waitForIdle()
  })
})
