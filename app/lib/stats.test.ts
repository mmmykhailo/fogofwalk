import { describe, expect, test } from "bun:test"
import { computeActivityStatsForPaths } from "./stats"

function point(
  lng: number,
  lat: number,
  timestampMs: number
): {
  lng: number
  lat: number
  timestampMs: number
} {
  return { lng, lat, timestampMs }
}

describe("computeActivityStatsForPaths", () => {
  test("does not add a distance or duration bridge between disconnected paths", () => {
    const result = computeActivityStatsForPaths([
      [point(14, 50, 1_000), point(14.01, 50, 2_000)],
      [point(15, 50, 60_000), point(15.01, 50, 61_000)],
    ])

    expect(result.distanceKm).toBeCloseTo(1.43, 1)
    expect(result.durationMs).toBe(60_000)
    expect(result.distanceKm).toBeLessThan(2)
  })
})
