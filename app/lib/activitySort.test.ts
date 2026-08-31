import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import {
  isActivitySortOption,
  sortActivitiesBy,
  sortActivitiesNewestFirst,
} from "./statsAggregator"

function activity(id: string, startedAtMs: number | null): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs,
    coordinates: [
      [0, 0],
      [1, 1],
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

describe("sortActivitiesNewestFirst", () => {
  test("shows latest dated activities first and undated activities last", () => {
    const input = [
      activity("old", 100),
      activity("undated", null),
      activity("new", 200),
    ]
    expect(sortActivitiesNewestFirst(input).map((item) => item.id)).toEqual([
      "new",
      "old",
      "undated",
    ])
    expect(input.map((item) => item.id)).toEqual(["old", "undated", "new"])
  })
})

describe("sortActivitiesBy", () => {
  test("sorts numeric metrics descending and places missing values last", () => {
    const short = activity("short", 100)
    short.stats.distanceKm = 1
    short.stats.durationMs = 1_000
    short.stats.elevationGainM = 10
    short.stats.avgMovingSpeedKmh = 3

    const long = activity("long", 200)
    long.stats.distanceKm = 2
    long.stats.durationMs = 2_000
    long.stats.elevationGainM = 20
    long.stats.avgMovingSpeedKmh = 4

    const unknown = activity("unknown", 300)

    expect(
      sortActivitiesBy([short, unknown, long], "distance").map(
        (item) => item.id
      )
    ).toEqual(["long", "short", "unknown"])
    expect(
      sortActivitiesBy([short, unknown, long], "speed").map((item) => item.id)
    ).toEqual(["long", "short", "unknown"])
    expect(
      sortActivitiesBy([short, unknown, long], "duration").map(
        (item) => item.id
      )
    ).toEqual(["long", "short", "unknown"])
    expect(
      sortActivitiesBy([short, unknown, long], "elevationGain").map(
        (item) => item.id
      )
    ).toEqual(["long", "short", "unknown"])
  })
})

describe("isActivitySortOption", () => {
  test("accepts only supported URL values", () => {
    expect(isActivitySortOption("distance")).toBe(true)
    expect(isActivitySortOption("unknown")).toBe(false)
    expect(isActivitySortOption(null)).toBe(false)
  })
})
