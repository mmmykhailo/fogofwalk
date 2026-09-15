import type { PublicProfileTotals, PublicWeeklyBar } from "~shared/api"

import type {
  LifetimeTotals,
  PersonalRecords,
  Streaks,
  WeeklyBar,
} from "~/lib/statsAggregator"

import { FIXTURE_ACTIVITY_START_MS, makeParsedActivity } from "./activities"

export function makeLifetimeTotals(
  overrides: Partial<LifetimeTotals> = {}
): LifetimeTotals {
  return {
    totalDistanceKm: 184.6,
    totalElevationGainM: 3_420,
    totalMovingTimeMs: 58_320_000,
    totalActivities: 24,
    activeDays: 19,
    avgSpeedKmh: 11.4,
    avgMovingSpeedKmh: 12.1,
    avgPaceMinPerKm: 5.26,
    avgMovingPaceMinPerKm: 4.96,
    ...overrides,
  }
}

export function makeWeeklyBars(
  count = 4,
  overrides: Partial<WeeklyBar> = {}
): WeeklyBar[] {
  return Array.from({ length: count }, (_, index) => {
    const startMs =
      FIXTURE_ACTIVITY_START_MS - (count - index - 1) * 7 * 86_400_000
    return {
      week: `2026-W${String(37 - (count - index - 1)).padStart(2, "0")}`,
      startMs,
      distanceKm: [12.4, 26.8, 0, 34.2][index % 4],
      activityCount: [2, 4, 0, 5][index % 4],
      ...overrides,
    }
  })
}

export function makeStreaks(overrides: Partial<Streaks> = {}): Streaks {
  return {
    currentStreakDays: 6,
    longestStreakDays: 18,
    recentDays: [
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-14",
      "2026-09-15",
    ],
    thisWeekKm: 18.2,
    lastWeekKm: 34.8,
    activeInWindowCount: 28,
    ...overrides,
  }
}

export function makePersonalRecords(
  overrides: Partial<PersonalRecords> = {}
): PersonalRecords {
  const longestActivity = makeParsedActivity({
    id: "record-longest",
    name: "Longest trail day",
    stats: { distanceKm: 42.2 },
  })
  const mostElevation = makeParsedActivity({
    id: "record-elevation",
    name: "Hill repeat",
    stats: { elevationGainM: 1_240 },
  })
  const fastestPace = makeParsedActivity({
    id: "record-pace",
    name: "Fast morning run",
    activityType: "running",
  })
  const fastestAvgSpeed = makeParsedActivity({
    id: "record-speed",
    name: "Open-road ride",
    activityType: "cycling",
  })
  const longestMovingTime = makeParsedActivity({
    id: "record-duration",
    name: "All-day route",
  })

  return {
    longestActivity: { activity: longestActivity, distanceKm: 42.2 },
    mostElevation: { activity: mostElevation, elevationGainM: 1_240 },
    fastestPace: { activity: fastestPace, paceMinPerKm: 4.25 },
    fastestAvgSpeed: { activity: fastestAvgSpeed, avgSpeedKmh: 28.4 },
    longestMovingTime: {
      activity: longestMovingTime,
      movingTimeMs: 6 * 3_600_000,
    },
    ...overrides,
  }
}

export function makePublicTotals(
  overrides: Partial<PublicProfileTotals> = {}
): PublicProfileTotals {
  return {
    totalDistanceKm: 96.4,
    totalElevationGainM: 1_680,
    totalMovingTimeMs: 28_800_000,
    totalActivities: 12,
    activeDays: 10,
    avgSpeedKmh: 10.8,
    avgMovingSpeedKmh: 11.5,
    avgPaceMinPerKm: 5.55,
    avgMovingPaceMinPerKm: 5.22,
    ...overrides,
  }
}

export function makePublicWeeklyBars(
  count = 4,
  overrides: Partial<PublicWeeklyBar> = {}
): PublicWeeklyBar[] {
  return makeWeeklyBars(count, overrides).map((bar) => ({
    week: bar.week,
    startMs: bar.startMs,
    distanceKm: bar.distanceKm,
    activityCount: bar.activityCount,
  }))
}
