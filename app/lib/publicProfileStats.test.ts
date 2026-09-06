import { expect, test } from "bun:test"
import type { PublicActivitySummary } from "~shared/api"
import { computePublicProfileStats } from "~/lib/publicProfileStats"
import { computeLifetimeTotals } from "~/lib/statsAggregator"
import type { ParsedActivity } from "~/types/activities"

function activity(
  overrides: Partial<PublicActivitySummary>
): PublicActivitySummary {
  return {
    contentHash: crypto.randomUUID(),
    name: "walk.gpx",
    startedAtMs: null,
    distanceKm: 0,
    durationMs: null,
    movingTimeMs: null,
    elevationGainM: 0,
    avgMovingSpeedKmh: null,
    ...overrides,
  }
}

test("computes weighted public profile totals and fills inactive weeks", () => {
  const stats = computePublicProfileStats([
    activity({
      startedAtMs: new Date(2026, 0, 5, 9).getTime(),
      distanceKm: 10,
      durationMs: 3_600_000,
    }),
    activity({
      startedAtMs: new Date(2026, 0, 19, 9).getTime(),
      distanceKm: 5,
      durationMs: 3_600_000,
    }),
  ])

  expect(stats.totals.totalActivities).toBe(2)
  expect(stats.totals.totalDistanceKm).toBe(15)
  expect(stats.totals.avgSpeedKmh).toBe(7.5)
  expect(stats.firstActivityMs).toBe(new Date(2026, 0, 5, 9).getTime())
  expect(stats.latestActivityMs).toBe(new Date(2026, 0, 19, 9).getTime())
  expect(stats.weekly.map((bar) => bar.distanceKm)).toEqual([10, 0, 5])
  expect(stats.weekly.map((bar) => bar.activityCount)).toEqual([1, 0, 1])
})

test("excludes untimed activities from elapsed-speed calculations", () => {
  const stats = computePublicProfileStats([
    activity({
      startedAtMs: new Date(2026, 0, 5).getTime(),
      distanceKm: 10,
      durationMs: 3_600_000,
    }),
    activity({
      startedAtMs: new Date(2026, 0, 6).getTime(),
      distanceKm: 20,
    }),
  ])

  expect(stats.totals.totalDistanceKm).toBe(30)
  expect(stats.totals.avgSpeedKmh).toBe(10)
})

test("returns null averages for timed zero-distance activities", () => {
  const stats = computePublicProfileStats([
    activity({ distanceKm: 0, durationMs: 3_600_000 }),
  ])

  expect(stats.totals.avgSpeedKmh).toBeNull()
  expect(stats.totals.avgPaceMinPerKm).toBeNull()
  expect(stats.totals.avgMovingSpeedKmh).toBeNull()
  expect(stats.totals.avgMovingPaceMinPerKm).toBeNull()
})

test("uses only contributing distance for finite weighted averages", () => {
  const stats = computePublicProfileStats([
    activity({ distanceKm: 0, durationMs: 3_600_000, movingTimeMs: 600_000 }),
    activity({
      distanceKm: 10,
      durationMs: 3_600_000,
      movingTimeMs: 1_800_000,
    }),
    activity({ distanceKm: 20 }),
  ])

  expect(stats.totals.totalDistanceKm).toBe(30)
  expect(stats.totals.avgSpeedKmh).toBe(5)
  expect(stats.totals.avgPaceMinPerKm).toBe(12)
  expect(stats.totals.avgMovingSpeedKmh).toBe(15)
  expect(stats.totals.avgMovingPaceMinPerKm).toBe(4)
  for (const value of Object.values(stats.totals)) {
    expect(
      value == null || typeof value !== "number" || Number.isFinite(value)
    ).toBe(true)
  }
})

test("shares weighted total rules with local activities", () => {
  const publicActivities = [
    activity({
      startedAtMs: new Date(2026, 0, 5).getTime(),
      distanceKm: 10,
      elevationGainM: 120,
      durationMs: 3_600_000,
      movingTimeMs: 3_000_000,
    }),
    activity({ distanceKm: 0, durationMs: 600_000, movingTimeMs: 600_000 }),
  ]
  const localActivities = publicActivities.map(
    (item) =>
      ({
        id: item.contentHash,
        name: item.name,
        format: "gpx",
        coordinates: [],
        startedAtMs: item.startedAtMs,
        stats: {
          distanceKm: item.distanceKm,
          elevationGainM: item.elevationGainM,
          elevationLossM: 0,
          hasElevation: false,
          durationMs: item.durationMs,
          movingTimeMs: item.movingTimeMs,
          uniqueDistanceKm: 0,
          avgPaceMinPerKm: null,
          avgMovingPaceMinPerKm: null,
          avgSpeedKmh: null,
          avgMovingSpeedKmh: null,
          elevationProfile: [],
        },
      }) satisfies ParsedActivity
  )

  expect(computePublicProfileStats(publicActivities).totals).toEqual(
    computeLifetimeTotals(localActivities)
  )
})
