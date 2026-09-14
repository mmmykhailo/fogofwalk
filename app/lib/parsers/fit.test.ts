import { describe, expect, test } from "bun:test"
import type { RawPoint } from "~shared/activities"
import { buildLapActivity } from "~/lib/laps"
import { buildLapsFromFit } from "./fit"

function point(lng: number, timestampMs: number): RawPoint {
  return { lng, lat: 0, timestampMs }
}

function lap(startMs: number, elapsed = 10) {
  return {
    start_time: startMs,
    total_elapsed_time: elapsed,
    lap_trigger: "distance",
  }
}

describe("FIT lap ranges", () => {
  test("shares adjacent boundaries inside one path", () => {
    const points = [0, 0.001, 0.002, 0.003, 0.004, 0.005].map((lng, i) =>
      point(lng, i * 1_000)
    )
    const laps = buildLapsFromFit(points, [lap(0), lap(3_000)])

    expect(
      laps?.map(({ number, startIndex, endIndex, pathRanges }) => ({
        number,
        startIndex,
        endIndex,
        pathRanges,
      }))
    ).toEqual([
      {
        number: 1,
        startIndex: 0,
        endIndex: 2,
        pathRanges: [{ pathIndex: 0, startIndex: 0, endIndex: 2 }],
      },
      {
        number: 2,
        startIndex: 2,
        endIndex: 5,
        pathRanges: [{ pathIndex: 0, startIndex: 2, endIndex: 5 }],
      },
    ])
  })

  test("never creates a range across a cleaned path gap", () => {
    const paths = [
      [
        point(0, 0),
        point(0.001, 1_000),
        point(0.002, 2_000),
        point(0.003, 3_000),
      ],
      [point(10, 3_000), point(10.001, 4_000), point(10.002, 5_000)],
    ]
    const laps = buildLapsFromFit(paths, [lap(0), lap(3_000, 99)])

    expect(laps).toHaveLength(2)
    expect(laps?.[0]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[1]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 2, endIndex: 3 },
      { pathIndex: 1, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[1]?.stats.durationMs).toBe(3_000)
  })

  test("builds a synthetic lap activity from path ranges", () => {
    const activity = {
      id: "activity",
      name: "ride.fit",
      startedAtMs: 0,
      coordinates: [
        [0, 0],
        [0.001, 0],
        [10, 0],
        [10.001, 0],
      ] as [number, number][],
      paths: [
        [
          [0, 0],
          [0.001, 0],
        ],
        [
          [10, 0],
          [10.001, 0],
        ],
      ] as [number, number][][],
      pathTimestamps: [
        [0, 1_000],
        [3_000, 4_000],
      ],
      format: "fit" as const,
      stats: {
        distanceKm: 1,
        uniqueDistanceKm: 1,
        elevationGainM: 0,
        elevationLossM: 0,
        hasElevation: false,
        durationMs: 4_000,
        movingTimeMs: 2_000,
        avgPaceMinPerKm: null,
        avgMovingPaceMinPerKm: null,
        avgSpeedKmh: null,
        avgMovingSpeedKmh: null,
        elevationProfile: [],
      },
    }
    const lapData = {
      number: 1,
      startIndex: 0,
      endIndex: 1,
      pathRanges: [
        { pathIndex: 0, startIndex: 0, endIndex: 1 },
        { pathIndex: 1, startIndex: 0, endIndex: 1 },
      ],
      startedAtMs: 0,
      stats: activity.stats,
    }

    const result = buildLapActivity(activity, lapData)

    expect(result.paths).toEqual([
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [10, 0],
        [10.001, 0],
      ],
    ])
    expect(result.pathTimestamps).toEqual([
      [0, 1_000],
      [3_000, 4_000],
    ])
    expect(result.coordinates).toHaveLength(4)
  })
})
