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
