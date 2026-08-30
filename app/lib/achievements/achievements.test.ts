import { describe, expect, test } from "bun:test"
import type { PublicActivityMeta } from "~shared/api"
import { computeEarnedAchievements, sortEarnedAchievementsNewestFirst } from "."

function activity(
  overrides: Partial<PublicActivityMeta> = {}
): PublicActivityMeta {
  return {
    contentHash: crypto.randomUUID(),
    name: "activity.gpx",
    isPublic: true,
    format: "gpx",
    startedAtMs: null,
    distanceKm: 0,
    pointCount: 2,
    sizeBytes: 100,
    updatedAt: 0,
    durationMs: null,
    movingTimeMs: null,
    elevationGainM: 0,
    avgMovingSpeedKmh: null,
    ...overrides,
  }
}

function earnedIds(activities: PublicActivityMeta[]): string[] {
  return computeEarnedAchievements(activities).map(
    ({ definition }) => definition.id
  )
}

describe("computeEarnedAchievements", () => {
  test.each([
    ["time-on-feet-3h", "running", 3, true],
    ["time-on-feet-3h", "walking", 3, true],
    ["time-on-feet-3h", "cycling", 3, false],
    ["time-on-feet-3h", undefined, 3, false],
    ["time-on-wheels-3h", "cycling", 3, true],
    ["time-on-wheels-3h", "running", 3, false],
    ["time-on-wheels-3h", "other", 3, false],
  ] as const)(
    "awards %s only to the eligible activity type",
    (id, activityType, hours, expected) => {
      expect(
        earnedIds([
          activity({ activityType, durationMs: hours * 60 * 60 * 1_000 }),
        ]).includes(id)
      ).toBe(expected)
    }
  )

  test.each([
    [
      "duration",
      activity({ activityType: "running", durationMs: 3 * 60 * 60 * 1_000 }),
      "time-on-feet-3h",
      true,
    ],
    [
      "duration",
      activity({
        activityType: "running",
        durationMs: 3 * 60 * 60 * 1_000 - 1,
      }),
      "time-on-feet-3h",
      false,
    ],
    [
      "duration",
      activity({ activityType: "running", durationMs: null }),
      "time-on-feet-3h",
      false,
    ],
    ["elevation", activity({ elevationGainM: 500 }), "elevation-500m", true],
    [
      "elevation",
      activity({ elevationGainM: 499.999 }),
      "elevation-500m",
      false,
    ],
  ])(
    "uses raw exact thresholds for %s",
    (_kind, qualifyingActivity, id, expected) => {
      expect(earnedIds([qualifyingActivity]).includes(id)).toBe(expected)
    }
  )

  test.each([
    ["running-5k", "running", 5],
    ["running-10k", "running", 10],
    ["running-half-marathon", "running", 21.0975],
    ["running-marathon", "running", 42.195],
    ["cycling-50k", "cycling", 50],
    ["cycling-100k", "cycling", 100],
    ["cycling-200k", "cycling", 200],
    ["walking-10k", "walking", 10],
    ["walking-25k", "walking", 25],
    ["walking-50k", "walking", 50],
    ["walking-75k", "walking", 75],
    ["walking-100k", "walking", 100],
  ] as const)(
    "awards %s at its exact metric threshold",
    (id, activityType, distanceKm) => {
      expect(earnedIds([activity({ activityType, distanceKm })])).toContain(id)
      expect(
        earnedIds([activity({ activityType, distanceKm: distanceKm - 0.0001 })])
      ).not.toContain(id)
    }
  )

  test("does not award distance tiers for wrong, missing, or unrelated types", () => {
    expect(
      earnedIds([activity({ activityType: "cycling", distanceKm: 42.195 })])
    ).not.toContain("running-marathon")
    expect(earnedIds([activity({ distanceKm: 100 })])).not.toContain(
      "walking-100k"
    )
    expect(
      earnedIds([activity({ activityType: "swimming", distanceKm: 100 })])
    ).not.toContain("walking-100k")
  })

  test.each([
    ["before_sunrise", "early-bird", true],
    ["after_sunset", "night-owl", true],
    ["daylight", "early-bird", false],
    ["unknown", "night-owl", false],
    [undefined, "night-owl", false],
  ] as const)("handles sun phase %s", (startSunPhase, id, expected) => {
    expect(earnedIds([activity({ startSunPhase })]).includes(id)).toBe(expected)
  })

  test("uses the earliest dated qualifying activity independently of endpoint order", () => {
    const earned = computeEarnedAchievements([
      activity({ activityType: "running", distanceKm: 10, startedAtMs: 30 }),
      activity({ activityType: "running", distanceKm: 10, startedAtMs: 10 }),
      activity({ activityType: "running", distanceKm: 10, startedAtMs: 20 }),
    ])

    expect(
      earned.find(({ definition }) => definition.id === "running-10k")
        ?.earnedAtMs
    ).toBe(10)
  })

  test("sorts achievements by newest day, then by difficulty, with undated awards last", () => {
    const earned = computeEarnedAchievements([
      activity({
        activityType: "running",
        distanceKm: 5,
        startedAtMs: new Date(2026, 0, 3, 9).getTime(),
      }),
      activity({
        activityType: "walking",
        distanceKm: 50,
        startedAtMs: new Date(2026, 0, 2, 18).getTime(),
      }),
      activity({
        activityType: "walking",
        distanceKm: 25,
        startedAtMs: new Date(2026, 0, 2, 8).getTime(),
      }),
      activity({ activityType: "cycling", distanceKm: 50 }),
    ])

    expect(
      sortEarnedAchievementsNewestFirst(earned).map(
        ({ definition }) => definition.id
      )
    ).toEqual([
      "running-5k",
      "walking-50k",
      "walking-25k",
      "walking-10k",
      "cycling-50k",
    ])
  })

  test("keeps an achievement earned by an undated legacy activity, with no award date", () => {
    const earned = computeEarnedAchievements([
      activity({ activityType: "running", distanceKm: 5 }),
    ])
    expect(
      earned.find(({ definition }) => definition.id === "running-5k")
        ?.earnedAtMs
    ).toBeNull()
  })

  test("evaluates exactly the supplied public endpoint input without making private-state assumptions", () => {
    expect(
      earnedIds([
        activity({ isPublic: false, activityType: "cycling", distanceKm: 50 }),
      ])
    ).toContain("cycling-50k")
  })
})
