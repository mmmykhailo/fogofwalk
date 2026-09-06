import type {
  PublicActivitySummary,
  PublicEarnedAchievement,
  PublicProfileTotals,
  PublicWeeklyBar,
} from "~shared/api"

const HOUR_MS = 60 * 60 * 1_000

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

export function toPublicActivitySummary(
  activity: PublicActivitySummary
): PublicActivitySummary {
  return {
    contentHash: activity.contentHash,
    name: activity.name,
    activityType: activity.activityType,
    startSunPhase: activity.startSunPhase,
    startedAtMs: activity.startedAtMs,
    distanceKm: activity.distanceKm,
    durationMs: activity.durationMs,
    movingTimeMs: activity.movingTimeMs,
    elevationGainM: activity.elevationGainM,
    avgMovingSpeedKmh: activity.avgMovingSpeedKmh,
  }
}

export function computePublicProfileTotals(
  activities: readonly PublicActivitySummary[]
): PublicProfileTotals {
  let totalDistanceKm = 0
  let totalElevationGainM = 0
  let totalMovingTimeMs = 0
  let timedDistanceKm = 0
  let totalDurationMs = 0
  let movingDistanceKm = 0
  const activeDays = new Set<string>()

  for (const activity of activities) {
    totalDistanceKm += activity.distanceKm
    totalElevationGainM += activity.elevationGainM
    if (activity.durationMs != null && activity.durationMs > 0) {
      timedDistanceKm += activity.distanceKm
      totalDurationMs += activity.durationMs
    }
    if (activity.movingTimeMs != null && activity.movingTimeMs > 0) {
      movingDistanceKm += activity.distanceKm
      totalMovingTimeMs += activity.movingTimeMs
    }
    if (activity.startedAtMs != null)
      activeDays.add(toLocalDateStr(activity.startedAtMs))
  }

  return {
    totalDistanceKm,
    totalElevationGainM,
    totalMovingTimeMs,
    totalActivities: activities.length,
    activeDays: activeDays.size,
    avgSpeedKmh:
      totalDurationMs > 0
        ? timedDistanceKm / (totalDurationMs / 3_600_000)
        : null,
    avgMovingSpeedKmh:
      totalMovingTimeMs > 0
        ? movingDistanceKm / (totalMovingTimeMs / 3_600_000)
        : null,
    avgPaceMinPerKm:
      totalDurationMs > 0 ? totalDurationMs / 60_000 / timedDistanceKm : null,
    avgMovingPaceMinPerKm:
      totalMovingTimeMs > 0
        ? totalMovingTimeMs / 60_000 / movingDistanceKm
        : null,
  }
}

export function computePublicWeeklyBars(
  activities: readonly PublicActivitySummary[],
  maxBars = Infinity
): PublicWeeklyBar[] {
  const bars = new Map<number, PublicWeeklyBar>()
  for (const activity of activities) {
    if (activity.startedAtMs == null) continue
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
  if (starts.length === 0) return []

  const result: PublicWeeklyBar[] = []
  for (
    let cursor = starts[0]!;
    cursor <= starts.at(-1)!;
    cursor = nextWeek(cursor)
  ) {
    result.push(
      bars.get(cursor) ?? {
        startMs: cursor,
        week: toWeekLabel(cursor),
        distanceKm: 0,
        activityCount: 0,
      }
    )
  }
  return result.slice(-maxBars)
}

function achievementIds(activity: PublicActivitySummary): string[] {
  const ids: string[] = []
  const durationHours =
    activity.durationMs == null ? 0 : activity.durationMs / HOUR_MS
  const onFeet =
    activity.activityType === "running" || activity.activityType === "walking"
  if (onFeet)
    for (const hours of [3, 12, 18, 24])
      if (durationHours >= hours) ids.push(`time-on-feet-${hours}h`)
  if (activity.activityType === "cycling")
    for (const hours of [3, 12, 18, 24])
      if (durationHours >= hours) ids.push(`time-on-wheels-${hours}h`)
  for (const metres of [500, 1_000, 2_000, 3_000, 5_000])
    if (activity.elevationGainM >= metres) ids.push(`elevation-${metres}m`)
  if (activity.startSunPhase === "before_sunrise") ids.push("early-bird")
  if (activity.startSunPhase === "after_sunset") ids.push("night-owl")
  const distances = {
    running: [
      ["running-5k", 5],
      ["running-10k", 10],
      ["running-half-marathon", 21.0975],
      ["running-marathon", 42.195],
    ],
    cycling: [
      ["cycling-50k", 50],
      ["cycling-100k", 100],
      ["cycling-200k", 200],
    ],
    walking: [
      ["walking-10k", 10],
      ["walking-25k", 25],
      ["walking-50k", 50],
      ["walking-75k", 75],
      ["walking-100k", 100],
    ],
  } as const
  if (
    activity.activityType === "running" ||
    activity.activityType === "cycling" ||
    activity.activityType === "walking"
  ) {
    for (const [id, distanceKm] of distances[activity.activityType])
      if (activity.distanceKm >= distanceKm) ids.push(id)
  }
  return ids
}

export function computePublicEarnedAchievements(
  activities: readonly PublicActivitySummary[]
): PublicEarnedAchievement[] {
  const earnedAt = new Map<string, number | null>()
  for (const activity of activities) {
    for (const id of achievementIds(activity)) {
      const current = earnedAt.get(id)
      if (
        current === undefined ||
        (activity.startedAtMs != null &&
          (current == null || activity.startedAtMs < current))
      ) {
        earnedAt.set(id, activity.startedAtMs)
      }
    }
  }
  return [...earnedAt].map(([id, earnedAtMs]) => ({ id, earnedAtMs }))
}

export function getPublicRecentDays(
  activities: readonly PublicActivitySummary[],
  maxDays = 84
): string[] {
  return [
    ...new Set(
      activities
        .flatMap((activity) =>
          activity.startedAtMs == null
            ? []
            : [toLocalDateStr(activity.startedAtMs)]
        )
        .sort()
        .slice(-maxDays)
    ),
  ]
}
