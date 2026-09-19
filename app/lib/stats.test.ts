import { describe, expect, test } from "bun:test"
import { computeActivityStatsForPaths } from "./stats"

function point(
  lng: number,
  lat: number,
  timestampMs?: number
): {
  lng: number
  lat: number
  timestampMs?: number
} {
  return { lng, lat, ...(timestampMs == null ? {} : { timestampMs }) }
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

  test("restarts elevation and moving-time calculations at anomaly-created gaps", () => {
    const result = computeActivityStatsForPaths([
      [
        { ...point(0, 0, 0), elevationM: 0 },
        { ...point(0.000045, 0, 10_000), elevationM: 0 },
      ],
      [
        { ...point(0.00009, 0, 20_000), elevationM: 100 },
        { ...point(0.000135, 0, 30_000), elevationM: 100 },
      ],
    ])

    expect(result.elevationGainM).toBe(0)
    expect(result.elevationLossM).toBe(0)
    expect(result.movingTimeMs).toBe(20_000)
    expect(result.durationMs).toBe(30_000)
    expect(result.distanceKm).toBeCloseTo(0.01, 1)
    expect(result.elevationProfile.at(-1)?.distanceKm).toBeCloseTo(
      result.distanceKm,
      6
    )
  })

  test("requires timestamps on both retained activity endpoints for duration", () => {
    const missingFirst = computeActivityStatsForPaths([
      [point(14, 50), point(14.01, 50, 2_000)],
      [point(15, 50, 60_000), point(15.01, 50, 61_000)],
    ])
    const missingLast = computeActivityStatsForPaths([
      [point(14, 50, 1_000), point(14.01, 50, 2_000)],
      [point(15, 50, 60_000), point(15.01, 50)],
    ])

    expect(missingFirst.durationMs).toBeNull()
    expect(missingLast.durationMs).toBeNull()
  })

  test("keeps elapsed duration across a cleaned gap but excludes its edge from every traversal metric", () => {
    const result = computeActivityStatsForPaths([
      [
        { ...point(0, 0, 0), elevationM: 0 },
        { ...point(0.001, 0, 1_000), elevationM: 0 },
      ],
      [
        { ...point(1, 0, 61_000), elevationM: 0 },
        { ...point(1.001, 0, 62_000), elevationM: 0 },
      ],
    ])
    expect(result.durationMs).toBe(62_000)
    expect(result.distanceKm).toBeCloseTo(0.222, 2)
    expect(result.distanceKm).toBeLessThan(2)
    expect(result.movingTimeMs).toBe(2_000)
    expect(result.elevationGainM).toBe(0)
    expect(result.elevationLossM).toBe(0)
  })
})
