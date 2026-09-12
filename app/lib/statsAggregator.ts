import type { ParsedActivity } from "~/types/activities"
import { computeUniqueDistancesInWorker } from "~/lib/uniqueDistanceWorkerClient"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LifetimeTotals {
  totalDistanceKm: number
  totalElevationGainM: number
  totalMovingTimeMs: number
  totalActivities: number
  activeDays: number
  /**
   * Library-wide averages — total distance ÷ total time, not the mean of the
   * per-activity averages, so long activities weigh more than short ones. Null
   * when no activity carries the matching time. See the `avgSpeed` vs
   * `avgMovingSpeed` note in CLAUDE.md.
   */
  avgSpeedKmh: number | null
  avgMovingSpeedKmh: number | null
  avgPaceMinPerKm: number | null
  avgMovingPaceMinPerKm: number | null
}

/**
 * The subset of an activity required for library and public-profile totals.
 * Both views use this contract so their weighted averages retain identical
 * denominator rules.
 */
export interface ActivityTotalsInput {
  startedAtMs: number | null
  distanceKm: number
  elevationGainM: number
  durationMs: number | null
  movingTimeMs: number | null
}

export interface WeeklyBar {
  /** ISO week label e.g. "2024-W03" */
  week: string
  /** Monday of that week in ms — used for x-axis labels */
  startMs: number
  distanceKm: number
  activityCount: number
}

export interface Streaks {
  currentStreakDays: number
  longestStreakDays: number
  /** "YYYY-MM-DD" strings for the last 84 days (12 weeks) that had activity */
  recentDays: string[]
  /** Total km in the current ISO week */
  thisWeekKm: number
  /** Total km in the previous ISO week */
  lastWeekKm: number
  /** Unique active days within the 84-day window */
  activeInWindowCount: number
}

export interface PersonalRecords {
  longestActivity: { activity: ParsedActivity; distanceKm: number } | null
  mostElevation: { activity: ParsedActivity; elevationGainM: number } | null
  fastestPace: { activity: ParsedActivity; paceMinPerKm: number } | null
  fastestAvgSpeed: { activity: ParsedActivity; avgSpeedKmh: number } | null
  longestMovingTime: { activity: ParsedActivity; movingTimeMs: number } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "YYYY-Www" (ISO 8601 week) for a given ms timestamp. */
function toISOWeek(ms: number): string {
  const d = new Date(ms)
  // Copy the date so we don't mutate
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // ISO weeks start on Monday; day 0 = Sunday in JS
  const day = tmp.getUTCDay() || 7
  // Thursday of the current week determines the year
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const year = tmp.getUTCFullYear()
  const startOfYear = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(
    ((tmp.getTime() - startOfYear.getTime()) / 86_400_000 + 1) / 7
  )
  return `${year}-W${String(week).padStart(2, "0")}`
}

/** Returns the Monday of the ISO week that contains the given ms timestamp. */
function mondayOfISOWeek(ms: number): number {
  const d = new Date(ms)
  const day = d.getUTCDay() || 7 // Mon=1 … Sun=7
  const monday = new Date(ms)
  monday.setUTCDate(d.getUTCDate() - (day - 1))
  monday.setUTCHours(0, 0, 0, 0)
  return monday.getTime()
}

/** Returns the local calendar date string "YYYY-MM-DD" for a ms timestamp. */
function toLocalDateStr(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

type ActivitySortItem = Pick<ParsedActivity, "startedAtMs"> & {
  stats: Pick<
    ParsedActivity["stats"],
    "distanceKm" | "durationMs" | "elevationGainM" | "avgMovingSpeedKmh"
  >
}

/** Returns a new array sorted chronologically, with undated items last. */
export function sortActivities<T extends ActivitySortItem>(
  activities: readonly T[]
): T[] {
  return [...activities].sort((a, b) => {
    if (a.startedAtMs == null && b.startedAtMs == null) return 0
    if (a.startedAtMs == null) return 1
    if (b.startedAtMs == null) return -1
    return a.startedAtMs - b.startedAtMs
  })
}

/** Newest-first activity-library ordering, with undated activities last. */
export function sortActivitiesNewestFirst<T extends ActivitySortItem>(
  activities: readonly T[]
): T[] {
  return [...activities].sort((a, b) => {
    if (a.startedAtMs == null && b.startedAtMs == null) return 0
    if (a.startedAtMs == null) return 1
    if (b.startedAtMs == null) return -1
    return b.startedAtMs - a.startedAtMs
  })
}

export const ACTIVITY_SORT_OPTIONS = [
  "distance",
  "speed",
  "duration",
  "elevationGain",
  "date",
] as const

export type ActivitySortOption = (typeof ACTIVITY_SORT_OPTIONS)[number]

export function isActivitySortOption(
  value: string | null
): value is ActivitySortOption {
  return ACTIVITY_SORT_OPTIONS.some((option) => option === value)
}

/** Returns activities sorted descending by the selected library metric. */
export function sortActivitiesBy<T extends ActivitySortItem>(
  activities: readonly T[],
  option: ActivitySortOption
): T[] {
  if (option === "date") return sortActivitiesNewestFirst(activities)

  const values: Record<
    Exclude<ActivitySortOption, "date">,
    (activity: ActivitySortItem) => number | null
  > = {
    distance: (activity) => activity.stats.distanceKm,
    speed: (activity) => activity.stats.avgMovingSpeedKmh,
    duration: (activity) => activity.stats.durationMs,
    elevationGain: (activity) => activity.stats.elevationGainM,
  }
  const valueFor = values[option]

  return [...activities].sort((a, b) => {
    const aValue = valueFor(a)
    const bValue = valueFor(b)
    if (aValue == null && bValue == null) return 0
    if (aValue == null) return 1
    if (bValue == null) return -1
    return bValue - aValue
  })
}

// ─── Aggregators ──────────────────────────────────────────────────────────────

export function computeActivityTotals(
  activities: readonly ActivityTotalsInput[]
): LifetimeTotals {
  let totalDistanceKm = 0
  let totalElevationGainM = 0
  let totalMovingTimeMs = 0
  let totalDurationMs = 0
  // Distance is accumulated per time kind so each average divides the distance
  // that actually produced the time — a GPX without timestamps must not inflate
  // the numerator of a ratio whose denominator it contributed nothing to.
  let timedDistanceKm = 0
  let movingDistanceKm = 0
  const daySet = new Set<string>()

  for (const activity of activities) {
    const {
      distanceKm,
      durationMs,
      movingTimeMs,
      elevationGainM,
      startedAtMs,
    } = activity
    totalDistanceKm += distanceKm
    totalElevationGainM += elevationGainM
    totalMovingTimeMs += movingTimeMs ?? 0
    if (durationMs != null && durationMs > 0) {
      totalDurationMs += durationMs
      timedDistanceKm += distanceKm
    }
    if (movingTimeMs != null && movingTimeMs > 0) {
      movingDistanceKm += distanceKm
    }
    if (startedAtMs != null) daySet.add(toLocalDateStr(startedAtMs))
  }

  const hasElapsed = totalDurationMs > 0 && timedDistanceKm > 0
  const hasMoving = totalMovingTimeMs > 0 && movingDistanceKm > 0

  return {
    totalDistanceKm,
    totalElevationGainM,
    totalMovingTimeMs,
    totalActivities: activities.length,
    activeDays: daySet.size,
    avgSpeedKmh: hasElapsed
      ? timedDistanceKm / (totalDurationMs / 3_600_000)
      : null,
    avgMovingSpeedKmh: hasMoving
      ? movingDistanceKm / (totalMovingTimeMs / 3_600_000)
      : null,
    avgPaceMinPerKm: hasElapsed
      ? totalDurationMs / 60_000 / timedDistanceKm
      : null,
    avgMovingPaceMinPerKm: hasMoving
      ? totalMovingTimeMs / 60_000 / movingDistanceKm
      : null,
  }
}

export function computeLifetimeTotals(
  activities: readonly ParsedActivity[]
): LifetimeTotals {
  return computeActivityTotals(
    activities.map((activity) => ({
      startedAtMs: activity.startedAtMs,
      distanceKm: activity.stats.distanceKm,
      elevationGainM: activity.stats.elevationGainM,
      durationMs: activity.stats.durationMs,
      movingTimeMs: activity.stats.movingTimeMs,
    }))
  )
}

export function computeWeeklyBars(activities: ParsedActivity[]): WeeklyBar[] {
  // Only dated activities contribute to the chart
  const dated = activities.filter(
    (t) => t.startedAtMs != null
  ) as (ParsedActivity & {
    startedAtMs: number
  })[]
  if (dated.length === 0) return []

  // Accumulate per week
  const weekMap = new Map<string, WeeklyBar>()
  for (const t of dated) {
    const week = toISOWeek(t.startedAtMs)
    const existing = weekMap.get(week)
    if (existing) {
      existing.distanceKm += t.stats.distanceKm
      existing.activityCount += 1
    } else {
      weekMap.set(week, {
        week,
        startMs: mondayOfISOWeek(t.startedAtMs),
        distanceKm: t.stats.distanceKm,
        activityCount: 1,
      })
    }
  }

  // Sort by startMs
  const sorted = [...weekMap.values()].sort((a, b) => a.startMs - b.startMs)
  if (sorted.length === 0) return []

  // Fill in zero-distance weeks between first and last active week
  const result: WeeklyBar[] = []
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
  let cursor = sorted[0].startMs
  const end = sorted[sorted.length - 1].startMs

  const byStart = new Map(sorted.map((b) => [b.startMs, b]))

  while (cursor <= end) {
    const week = toISOWeek(cursor)
    result.push(
      byStart.get(cursor) ?? {
        week,
        startMs: cursor,
        distanceKm: 0,
        activityCount: 0,
      }
    )
    cursor += ONE_WEEK_MS
  }

  return result
}

export function computeStreaks(
  activities: ParsedActivity[],
  todayMs: number
): Streaks {
  const dated = activities.filter((t) => t.startedAtMs != null)
  if (dated.length === 0) {
    return {
      currentStreakDays: 0,
      longestStreakDays: 0,
      recentDays: [],
      thisWeekKm: 0,
      lastWeekKm: 0,
      activeInWindowCount: 0,
    }
  }

  // Unique local calendar days, sorted ascending
  const daySet = new Set(dated.map((t) => toLocalDateStr(t.startedAtMs!)))
  const days = [...daySet].sort()

  // Longest streak — single forward pass
  let longestStreakDays = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1])
    const curr = new Date(days[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      run++
      longestStreakDays = Math.max(longestStreakDays, run)
    } else {
      run = 1
    }
  }

  // Current streak — walk backward from today
  const todayStr = toLocalDateStr(todayMs)
  let currentStreakDays = 0
  const daySetLookup = new Set(days)
  let check = todayStr
  while (daySetLookup.has(check)) {
    currentStreakDays++
    const d = new Date(check)
    d.setDate(d.getDate() - 1)
    check = toLocalDateStr(d.getTime())
  }

  // Collect active days within the last 84 days (12 weeks) for the activity grid
  const cutoff = new Date(todayMs)
  cutoff.setDate(cutoff.getDate() - 83)
  const cutoffStr = toLocalDateStr(cutoff.getTime())
  const recentDays = [...daySet].filter((d) => d >= cutoffStr)
  const activeInWindowCount = recentDays.length

  // This week vs last week km
  const thisWeek = toISOWeek(todayMs)
  const lastWeekMs = todayMs - 7 * 24 * 60 * 60 * 1000
  const lastWeek = toISOWeek(lastWeekMs)
  let thisWeekKm = 0
  let lastWeekKm = 0
  for (const t of dated) {
    const w = toISOWeek(t.startedAtMs!)
    if (w === thisWeek) thisWeekKm += t.stats.distanceKm
    else if (w === lastWeek) lastWeekKm += t.stats.distanceKm
  }

  return {
    currentStreakDays,
    longestStreakDays,
    recentDays,
    thisWeekKm,
    lastWeekKm,
    activeInWindowCount,
  }
}

export function computePersonalRecords(
  activities: ParsedActivity[]
): PersonalRecords {
  if (activities.length === 0) {
    return {
      longestActivity: null,
      mostElevation: null,
      fastestPace: null,
      fastestAvgSpeed: null,
      longestMovingTime: null,
    }
  }

  let longestActivity: PersonalRecords["longestActivity"] = null
  let mostElevation: PersonalRecords["mostElevation"] = null
  let fastestPace: PersonalRecords["fastestPace"] = null
  let fastestAvgSpeed: PersonalRecords["fastestAvgSpeed"] = null
  let longestMovingTime: PersonalRecords["longestMovingTime"] = null

  for (const t of activities) {
    const {
      distanceKm,
      elevationGainM,
      avgMovingPaceMinPerKm,
      avgSpeedKmh,
      movingTimeMs,
    } = t.stats

    if (longestActivity == null || distanceKm > longestActivity.distanceKm) {
      longestActivity = { activity: t, distanceKm }
    }

    if (
      mostElevation == null ||
      elevationGainM > mostElevation.elevationGainM
    ) {
      mostElevation = { activity: t, elevationGainM }
    }

    if (
      avgMovingPaceMinPerKm != null &&
      avgMovingPaceMinPerKm > 0 &&
      (fastestPace == null || avgMovingPaceMinPerKm < fastestPace.paceMinPerKm)
    ) {
      fastestPace = { activity: t, paceMinPerKm: avgMovingPaceMinPerKm }
    }

    if (
      avgSpeedKmh != null &&
      avgSpeedKmh > 0 &&
      (fastestAvgSpeed == null || avgSpeedKmh > fastestAvgSpeed.avgSpeedKmh)
    ) {
      fastestAvgSpeed = { activity: t, avgSpeedKmh }
    }

    if (
      movingTimeMs != null &&
      movingTimeMs > 0 &&
      (longestMovingTime == null ||
        movingTimeMs > longestMovingTime.movingTimeMs)
    ) {
      longestMovingTime = { activity: t, movingTimeMs }
    }
  }

  return {
    longestActivity,
    mostElevation,
    fastestPace,
    fastestAvgSpeed,
    longestMovingTime,
  }
}

/**
 * Total already-computed library-wide unique distance.
 */
export function computeUniqueDistance(activities: ParsedActivity[]): number {
  return activities.reduce(
    (total, activity) => total + activity.stats.uniqueDistanceKm,
    0
  )
}

/** Compute unique distances off-thread and write them onto each activity in place. */
export async function populateUniqueDistances(
  activities: ParsedActivity[]
): Promise<void> {
  const result = await computeUniqueDistancesInWorker(activities)
  for (const activity of activities) {
    activity.stats.uniqueDistanceKm =
      result.get(activity.id) ?? activity.stats.distanceKm
  }
}
