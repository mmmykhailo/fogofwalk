import { expect, test } from "bun:test"
import type { PublicActivityMeta } from "~shared/api"
import { computePublicProfileStats } from "~/lib/publicProfileStats"

function activity(overrides: Partial<PublicActivityMeta>): PublicActivityMeta {
  return {
    contentHash: crypto.randomUUID(),
    name: "walk.gpx",
    isPublic: true,
    format: "gpx",
    startedAtMs: null,
    distanceKm: 0,
    pointCount: 2,
    sizeBytes: 100,
    updatedAt: 0,
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
