import { describe, expect, test } from "bun:test"
import type { PublicActivityMeta } from "~shared/api"
import { computePublicAchievementPrevalence } from "../src/public/achievementPrevalence"
import { MemoryStore } from "../src/store/memory"

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

describe("public achievement prevalence cache", () => {
  test("reuses snapshots and invalidates after activity mutations", async () => {
    const store = new MemoryStore()
    const user = await store.upsertUserFromIdentity({
      provider: "github",
      providerUserId: "cache-user",
      login: "cache-user",
      displayName: "Cache User",
      avatarUrl: null,
      email: null,
    })
    const first = await store.getPublicAchievementPrevalence()
    expect(await store.getPublicAchievementPrevalence()).toBe(first)

    await store.putActivity(
      user.id,
      activity({ activityType: "running", distanceKm: 5 }),
      new Uint8Array()
    )
    const afterUpload = await store.getPublicAchievementPrevalence()
    expect(afterUpload).not.toBe(first)
    expect(afterUpload.eligibleUserCount).toBe(1)
    expect(afterUpload.earnedUserCounts["running-5k"]).toBe(1)
    expect(await store.getPublicAchievementPrevalence()).toBe(afterUpload)

    await store.setActivityVisibility(user.id, "activity", false)
    const afterHide = await store.getPublicAchievementPrevalence()
    expect(afterHide.eligibleUserCount).toBe(0)
    expect(afterHide.earnedUserCounts["running-5k"]).toBeUndefined()

    await store.setActivityVisibility(user.id, "activity", true)
    await store.deleteActivity(user.id, "activity")
    const afterDelete = await store.getPublicAchievementPrevalence()
    expect(afterDelete.eligibleUserCount).toBe(0)
  })
})
