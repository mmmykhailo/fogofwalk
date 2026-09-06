import type { PublicAchievementPrevalence, ActivityMeta } from "~shared/api"

const HOUR_MS = 60 * 60 * 1_000

type PublicActivity = { userId: string; activity: ActivityMeta }

function earnedAchievementIds(activity: ActivityMeta): string[] {
  const ids: string[] = []
  const durationHours =
    activity.durationMs == null ? 0 : activity.durationMs / HOUR_MS
  const onFeet =
    activity.activityType === "running" || activity.activityType === "walking"

  if (onFeet) {
    for (const hours of [3, 12, 18, 24]) {
      if (durationHours >= hours) ids.push(`time-on-feet-${hours}h`)
    }
  }
  if (activity.activityType === "cycling") {
    for (const hours of [3, 12, 18, 24]) {
      if (durationHours >= hours) ids.push(`time-on-wheels-${hours}h`)
    }
  }
  for (const metres of [500, 1_000, 2_000, 3_000, 5_000]) {
    if (activity.elevationGainM >= metres) ids.push(`elevation-${metres}m`)
  }
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
    for (const [id, distanceKm] of distances[activity.activityType]) {
      if (activity.distanceKm >= distanceKm) ids.push(id)
    }
  }
  return ids
}

export function computePublicAchievementPrevalence(
  activities: readonly PublicActivity[]
): PublicAchievementPrevalence {
  const eligibleUserIds = new Set(activities.map(({ userId }) => userId))
  const earnersByAchievement = new Map<string, Set<string>>()

  for (const { userId, activity } of activities) {
    for (const id of earnedAchievementIds(activity)) {
      const earners = earnersByAchievement.get(id) ?? new Set<string>()
      earners.add(userId)
      earnersByAchievement.set(id, earners)
    }
  }

  return Object.fromEntries(
    [...earnersByAchievement].map(([id, earners]) => [
      id,
      eligibleUserIds.size === 0
        ? 0
        : Math.round((earners.size / eligibleUserIds.size) * 100),
    ])
  )
}
