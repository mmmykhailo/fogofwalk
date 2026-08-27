import type { PublicActivityMeta } from "~shared/api"
import type { ActivityType } from "~shared/activities"

export type AchievementFamily = "duration" | "elevation" | "sun" | "distance"

export interface AchievementDefinition {
  id: string
  family: AchievementFamily
  title: string
  description: string
  activityTypes?: readonly ActivityType[]
  qualifies(activity: PublicActivityMeta): boolean
}

export interface EarnedAchievement {
  definition: AchievementDefinition
  /** The oldest dated public activity that satisfies the definition. */
  earnedAtMs: number | null
}
