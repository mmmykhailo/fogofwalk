import { describe, expect, test } from "bun:test"
import type { ActivityDraft } from "~shared/activities"
import { computeContentHashCandidates } from "~/lib/activityHash"
import { normalizeActivity, normalizeAndHashActivity } from "./normalize"

const stats = {
  distanceKm: 1,
  uniqueDistanceKm: 1,
  elevationGainM: 0,
  elevationLossM: 0,
  hasElevation: false,
  durationMs: null,
  movingTimeMs: null,
  avgPaceMinPerKm: null,
  avgMovingPaceMinPerKm: null,
  avgSpeedKmh: null,
  avgMovingSpeedKmh: null,
  elevationProfile: [],
}

function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    name: "track.gpx",
    startedAtMs: 0,
    format: "gpx",
    stats,
    paths: [
      [
        [14, 50],
        [14.01, 50.01],
      ],
      [
        [15, 51],
        [15.01, 51.01],
      ],
    ],
    ...overrides,
  }
}

describe("normalizeActivity", () => {
  test("creates a canonical path-aware activity without flattening", () => {
    const result = normalizeActivity(draft())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.activity.paths).toHaveLength(2)
    expect("coordinates" in result.activity).toBe(false)
    expect(result.activity.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test("normalizes legacy coordinates and validates timestamps", () => {
    const result = normalizeActivity(
      draft({
        paths: undefined,
        coordinates: [
          [0, 0],
          [0, 0],
          [1, 1],
        ],
        pointTimestamps: [100, -1, 200],
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.activity.paths).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
    ])
    expect(result.activity.pathTimestamps).toEqual([[100, 200]])
    expect(result.warnings.map(({ code }) => code)).toEqual([
      "coalesced_duplicate_point",
    ])
  })

  test("stamps v2 and exposes the legacy alias for one-path migration", async () => {
    const result = await normalizeAndHashActivity(
      draft({
        paths: [
          [
            [14, 50],
            [14.01, 50.01],
          ],
        ],
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.activity.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await computeContentHashCandidates(result.activity)).toHaveLength(2)
  })
})
