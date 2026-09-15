import type { PublicProfileResponse } from "~shared/api"

import { FIXTURE_ACTIVITY_START_MS, makePublicActivity } from "./activities"
import { makeSavedPoint } from "./savedPoints"
import { makePublicTotals, makePublicWeeklyBars } from "./stats"

export { makePublicActivity }

export function makePublicProfile(
  overrides: Partial<PublicProfileResponse> = {}
): PublicProfileResponse {
  const savedPoints = [makeSavedPoint({ isPublic: true })]
  const recentActivities = [
    makePublicActivity(),
    makePublicActivity({
      contentHash: "fixture-public-hash-2",
      name: "Forest ascent",
      activityType: "running",
      startedAtMs: FIXTURE_ACTIVITY_START_MS - 86_400_000,
      distanceKm: 12.1,
      elevationGainM: 286,
    }),
  ]

  return {
    user: {
      handle: "alex-trail",
      displayName: "Alex Trail",
      avatarUrl: "https://example.test/avatar/alex.png",
    },
    savedPoints,
    savedPointCount: savedPoints.length,
    totals: makePublicTotals(),
    firstActivityMs: FIXTURE_ACTIVITY_START_MS - 180 * 86_400_000,
    latestActivityMs: FIXTURE_ACTIVITY_START_MS,
    recentDays: ["2026-09-12", "2026-09-14", "2026-09-15"],
    weekly: makePublicWeeklyBars(),
    achievements: [
      { id: "distance-100", earnedAtMs: FIXTURE_ACTIVITY_START_MS },
    ],
    achievementPrevalence: { "distance-100": 18.4 },
    recentActivities,
    ...overrides,
  }
}
