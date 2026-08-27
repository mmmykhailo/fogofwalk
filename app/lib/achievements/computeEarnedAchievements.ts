import type { PublicActivityMeta } from "~shared/api"
import { ACHIEVEMENT_DEFINITIONS } from "./definitions"
import type { AchievementDefinition, EarnedAchievement } from "./types"

function earliestQualifyingDate(
  activities: readonly PublicActivityMeta[],
  definition: AchievementDefinition
): number | null {
  let earliest: number | null = null

  for (const activity of activities) {
    if (
      !definition.qualifies(activity) ||
      typeof activity.startedAtMs !== "number"
    )
      continue
    if (earliest === null || activity.startedAtMs < earliest) {
      earliest = activity.startedAtMs
    }
  }

  return earliest
}

/** Returns every earned tier, in catalogue order, from the supplied public metadata. */
export function computeEarnedAchievements(
  activities: readonly PublicActivityMeta[]
): EarnedAchievement[] {
  return ACHIEVEMENT_DEFINITIONS.flatMap((definition) => {
    if (!activities.some(definition.qualifies)) return []
    return [
      {
        definition,
        earnedAtMs: earliestQualifyingDate(activities, definition),
      },
    ]
  })
}

/** Returns a newest-first copy, keeping undated legacy achievements last. */
export function sortEarnedAchievementsNewestFirst(
  achievements: readonly EarnedAchievement[]
): EarnedAchievement[] {
  return [...achievements].sort((a, b) => {
    if (a.earnedAtMs === null && b.earnedAtMs === null) return 0
    if (a.earnedAtMs === null) return 1
    if (b.earnedAtMs === null) return -1
    return b.earnedAtMs - a.earnedAtMs
  })
}
