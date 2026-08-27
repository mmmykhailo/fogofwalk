import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { sortActivitiesNewestFirst } from "./statsAggregator"

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
