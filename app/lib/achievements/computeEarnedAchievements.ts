import type { PublicActivityMeta } from "~shared/api"
import { ACHIEVEMENT_DEFINITIONS } from "./definitions"
import type { AchievementDefinition, EarnedAchievement } from "./types"

const ACHIEVEMENT_DIFFICULTY = new Map(
  ACHIEVEMENT_DEFINITIONS.map((definition, index) => [definition.id, index])
)

function localDayStart(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

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

/**
 * Returns a newest-first copy, keeping undated legacy achievements last.
 * Achievements earned on the same local calendar day are ordered by difficulty.
 */
export function sortEarnedAchievementsNewestFirst(
  achievements: readonly EarnedAchievement[]
): EarnedAchievement[] {
  return [...achievements].sort((a, b) => {
    if (a.earnedAtMs === null && b.earnedAtMs === null) return 0
    if (a.earnedAtMs === null) return 1
    if (b.earnedAtMs === null) return -1

    const dayDifference =
      localDayStart(b.earnedAtMs) - localDayStart(a.earnedAtMs)
    if (dayDifference !== 0) return dayDifference

    return (
      (ACHIEVEMENT_DIFFICULTY.get(b.definition.id) ?? -1) -
      (ACHIEVEMENT_DIFFICULTY.get(a.definition.id) ?? -1)
    )
  })
}
