import { describe, expect, test } from "bun:test"
import type { PublicActivityMeta } from "~shared/api"
import { computePublicAchievementPrevalence } from "../src/public/achievementPrevalence"

function activity(
  overrides: Partial<PublicActivityMeta> = {}
): PublicActivityMeta {
  return {
    contentHash: "activity",
    name: "Activity",
    isPublic: true,
    format: "gpx",
    startedAtMs: null,
    distanceKm: 1,
    pointCount: 2,
    sizeBytes: 1,
    updatedAt: 1,
    durationMs: null,
    movingTimeMs: null,
    elevationGainM: 0,
    avgMovingSpeedKmh: null,
    ...overrides,
  }
}

describe("computePublicAchievementPrevalence", () => {
  test("counts each qualifying member once and excludes users without public activity", () => {
    const prevalence = computePublicAchievementPrevalence([
      {
        userId: "one",
        activity: activity({ activityType: "running", distanceKm: 10 }),
      },
      {
        userId: "one",
        activity: activity({ activityType: "running", distanceKm: 5 }),
      },
      {
        userId: "two",
        activity: activity({ activityType: "running", distanceKm: 5 }),
      },
    ])

    expect(prevalence.eligibleUserCount).toBe(2)
    expect(prevalence.earnedUserCounts["running-5k"]).toBe(2)
    expect(prevalence.earnedUserCounts["running-10k"]).toBe(1)
  })
})
