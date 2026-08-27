import type { PublicActivityMeta } from "~shared/api"
import type { ActivityType } from "~shared/activities"
import type { AchievementDefinition } from "./types"

const HOUR_MS = 60 * 60 * 1_000
const TIME_ON_FEET_TYPES = ["running", "walking"] as const
const TIME_ON_WHEELS_TYPES = ["cycling"] as const

function hasActivityType(
  activity: PublicActivityMeta,
  activityTypes: readonly ActivityType[]
): boolean {
  return (
    activity.activityType !== undefined &&
    activityTypes.includes(activity.activityType)
  )
}

function durationDefinition(
  id: string,
  title: string,
  hours: number,
  activityTypes: readonly ActivityType[]
): AchievementDefinition {
  return {
    id,
    family: "duration",
    title,
    description: `${hours} hours in one activity`,
    activityTypes,
    qualifies: (activity) =>
      hasActivityType(activity, activityTypes) &&
      activity.durationMs !== null &&
      activity.durationMs >= hours * HOUR_MS,
  }
}

function elevationDefinition(metres: number): AchievementDefinition {
  return {
    id: `elevation-${metres}m`,
    family: "elevation",
    title: `${metres.toLocaleString("en-US")} m climbed`,
    description: `${metres.toLocaleString("en-US")} m elevation gain in one activity`,
    qualifies: (activity) => activity.elevationGainM >= metres,
  }
}

function distanceDefinition(
  id: string,
  title: string,
  distanceKm: number,
  activityType: ActivityType
): AchievementDefinition {
  return {
    id,
    family: "distance",
    title,
    description: `${distanceKm} km in one activity`,
    activityTypes: [activityType],
    qualifies: (activity) =>
      activity.activityType === activityType &&
      activity.distanceKm >= distanceKm,
  }
}

/** Stable, declarative catalogue for the public-profile achievement cards. */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  ...[3, 12, 18, 24].map((hours) =>
    durationDefinition(
      `time-on-feet-${hours}h`,
      `${hours} hours on feet`,
      hours,
      TIME_ON_FEET_TYPES
    )
  ),
  ...[3, 12, 18, 24].map((hours) =>
    durationDefinition(
      `time-on-wheels-${hours}h`,
      `${hours} hours on wheels`,
      hours,
      TIME_ON_WHEELS_TYPES
    )
  ),
  ...[500, 1_000, 2_000, 3_000, 5_000].map(elevationDefinition),
  {
    id: "early-bird",
    family: "sun",
    title: "Early bird",
    description: "Started before local sunrise",
    qualifies: (activity) => activity.startSunPhase === "before_sunrise",
  },
  {
    id: "night-owl",
    family: "sun",
    title: "Night owl",
    description: "Started after local sunset",
    qualifies: (activity) => activity.startSunPhase === "after_sunset",
  },
  distanceDefinition("running-5k", "5K", 5, "running"),
  distanceDefinition("running-10k", "10K", 10, "running"),
  distanceDefinition(
    "running-half-marathon",
    "Half marathon",
    21.0975,
    "running"
  ),
  distanceDefinition("running-marathon", "Marathon", 42.195, "running"),
  distanceDefinition("cycling-50k", "50 km ride", 50, "cycling"),
  distanceDefinition("cycling-100k", "100 km ride", 100, "cycling"),
  distanceDefinition("cycling-200k", "200 km ride", 200, "cycling"),
  distanceDefinition("walking-10k", "10 km walk", 10, "walking"),
  distanceDefinition("walking-25k", "25 km walk", 25, "walking"),
  distanceDefinition("walking-50k", "50 km walk", 50, "walking"),
  distanceDefinition("walking-75k", "75 km walk", 75, "walking"),
  distanceDefinition("walking-100k", "100 km walk", 100, "walking"),
]
