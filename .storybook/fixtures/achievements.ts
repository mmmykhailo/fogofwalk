import type { PublicAchievementPrevalence } from "~shared/api"

import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementFamily,
  type EarnedAchievement,
} from "~/lib/achievements"

import { FIXTURE_ACTIVITY_START_MS } from "./activities"

const definitionsById = new Map(
  ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition])
)

export function makeEarnedAchievement(
  id: string,
  overrides: Partial<EarnedAchievement> = {}
): EarnedAchievement {
  const definition = definitionsById.get(id)
  if (!definition) throw new Error(`Unknown achievement fixture: ${id}`)
  return {
    definition,
    earnedAtMs: FIXTURE_ACTIVITY_START_MS,
    ...overrides,
  }
}

export function makeAchievements(
  ids: readonly string[] = [
    "time-on-feet-3h",
    "elevation-500m",
    "early-bird",
    "running-5k",
  ]
): EarnedAchievement[] {
  return ids.map((id) => makeEarnedAchievement(id))
}

export function makeAchievementsByFamily(
  family: AchievementFamily
): EarnedAchievement[] {
  return ACHIEVEMENT_DEFINITIONS.filter(
    (definition) => definition.family === family
  ).map(({ id }) => makeEarnedAchievement(id))
}

export function makeAchievementPrevalence(
  entries: Record<string, number> = {
    "time-on-feet-3h": 100,
    "elevation-500m": 2.5,
    "early-bird": 0,
    "running-5k": 18.4,
  }
): PublicAchievementPrevalence {
  return { ...entries }
}
