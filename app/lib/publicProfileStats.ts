import type { PublicActivityMeta } from "~shared/api"
import {
  computeActivityTotals,
  type LifetimeTotals,
  type WeeklyBar,
} from "~/lib/statsAggregator"

export interface PublicProfileStats {
  totals: LifetimeTotals
  firstActivityMs: number | null
  latestActivityMs: number | null
  recentDays: string[]
  weekly: WeeklyBar[]
}

function toLocalDateStr(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function startOfWeek(ms: number): number {
  const date = new Date(ms)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function nextWeek(startMs: number): number {
  const date = new Date(startMs)
  date.setDate(date.getDate() + 7)
  return date.getTime()
}

function toWeekLabel(startMs: number): string {
  return new Date(startMs).toISOString().slice(0, 10)
}

function buildWeeklyBars(activities: PublicActivityMeta[]): WeeklyBar[] {
  const datedActivities = activities.filter(
    (activity): activity is PublicActivityMeta & { startedAtMs: number } =>
      activity.startedAtMs != null
  )
  if (datedActivities.length === 0) return []

  const bars = new Map<number, WeeklyBar>()

  for (const activity of datedActivities) {
    const startMs = startOfWeek(activity.startedAtMs)
    const bar = bars.get(startMs) ?? {
      startMs,
      week: toWeekLabel(startMs),
      distanceKm: 0,
      activityCount: 0,
    }
    bar.distanceKm += activity.distanceKm
    bar.activityCount += 1
    bars.set(startMs, bar)
  }

  const starts = [...bars.keys()].sort((a, b) => a - b)
  const result: WeeklyBar[] = []
  for (
    let cursor = starts[0];
    cursor <= starts.at(-1)!;
    cursor = nextWeek(cursor)
  ) {
    const bar = bars.get(cursor)
    result.push(
      bar
        ? {
            startMs: bar.startMs,
            week: bar.week,
            distanceKm: bar.distanceKm,
            activityCount: bar.activityCount,
          }
        : {
            startMs: cursor,
            week: toWeekLabel(cursor),
            distanceKm: 0,
            activityCount: 0,
          }
    )
  }
  return result
}

export function computePublicProfileStats(
  activities: PublicActivityMeta[]
): PublicProfileStats {
  const dates: number[] = []
  const recentDays = new Set<string>()

  for (const activity of activities) {
    if (activity.startedAtMs != null) {
      dates.push(activity.startedAtMs)
      recentDays.add(toLocalDateStr(activity.startedAtMs))
    }
  }

  dates.sort((a, b) => a - b)
  return {
    totals: computeActivityTotals(activities),
    firstActivityMs: dates[0] ?? null,
    latestActivityMs: dates.at(-1) ?? null,
    recentDays: [...recentDays],
    weekly: buildWeeklyBars(activities),
  }
}
