import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { mergeUniqueDistanceStats } from "./mapStore"

function activity(
  id: string,
  metadata: Pick<ParsedActivity, "name" | "activityType" | "isPublic"> = {
    name: id,
    activityType: "walking",
    isPublic: false,
  }
): ParsedActivity {
  return {
    id,
    ...metadata,
    startedAtMs: null,
    startSunPhase: "daylight",
    contentHash: `hash-${id}`,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    stats: {
      distanceKm: 4,
      uniqueDistanceKm: 4,
      elevationGainM: 10,
      elevationLossM: 5,
      hasElevation: true,
      durationMs: 3_600_000,
      movingTimeMs: 3_500_000,
      avgPaceMinPerKm: 6,
      avgMovingPaceMinPerKm: 5.8,
      avgSpeedKmh: 10,
      avgMovingSpeedKmh: 10.2,
      elevationProfile: [1, 2],
    },
  }
}

describe("mergeUniqueDistanceStats", () => {
  test("preserves current metadata and nested geometry while applying distance", () => {
    const current = activity("one", {
      name: "New metadata",
      activityType: "cycling",
      isPublic: true,
    })
    const untouched = activity("two")
    const staleWorkerInput = activity("one", {
      name: "Old metadata",
      activityType: "running",
      isPublic: false,
    })
    staleWorkerInput.startSunPhase = "before_sunrise"
    staleWorkerInput.stats = {
      ...staleWorkerInput.stats,
      uniqueDistanceKm: 2,
      distanceKm: 99,
    }

    const [merged, same] = mergeUniqueDistanceStats(
      [current, untouched],
      [staleWorkerInput]
    )

    expect(merged).not.toBe(current)
    expect(merged).toMatchObject({
      id: "one",
      name: "New metadata",
      activityType: "cycling",
      isPublic: true,
      startSunPhase: "daylight",
      stats: { distanceKm: 4, uniqueDistanceKm: 2 },
    })
    expect(merged.coordinates).toBe(current.coordinates)
    expect(merged.stats.elevationProfile).toBe(current.stats.elevationProfile)
    expect(same).toBe(untouched)
  })

  test("reuses the current record when the projected value is unchanged", () => {
    const current = activity("one")
    const projected = activity("one", {
      name: "stale worker metadata",
      activityType: "running",
      isPublic: true,
    })

    const result = mergeUniqueDistanceStats([current], [projected])
    expect(result).toEqual([current])
    expect(result[0]).toBe(current)
  })
})
