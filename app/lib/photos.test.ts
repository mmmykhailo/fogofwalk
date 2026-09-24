import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { matchPhotoToActivity } from "./photos"

function activity(): ParsedActivity {
  const paths: [number, number][][] = [
    [
      [14, 50],
      [14.01, 50.01],
    ],
    [
      [-122, 37],
      [-122.01, 37.01],
    ],
  ]
  return {
    id: "multi-path",
    name: "multi-path",
    startedAtMs: 1_000,
    coordinates: paths[0]!,
    paths,
    pathTimestamps: [
      [1_000, 2_000],
      [3_000, 4_000],
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

describe("photo activity matching", () => {
  test("[I-037] matches timestamps and coordinates within each disconnected path", () => {
    expect(matchPhotoToActivity(3_600, [activity()])).toEqual({
      lng: -122.01,
      lat: 37.01,
    })
  })

  test("does not use an omitted pause-drift sample as a photo candidate", () => {
    const cleaned = activity()
    cleaned.paths = [
      [
        [14, 50],
        [14.01, 50.01],
      ],
      [
        [-122, 37],
        [-122.01, 37.01],
      ],
    ]
    cleaned.pathTimestamps = [
      [0, 3_600_000],
      [10_000_000, 10_001_000],
    ]

    expect(matchPhotoToActivity(1_800_000, [cleaned])).toBeNull()
  })
})
