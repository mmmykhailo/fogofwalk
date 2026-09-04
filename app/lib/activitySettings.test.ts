import { describe, expect, test } from "bun:test"
import {
  commonActivityType,
  commonPublicity,
  MIXED_ACTIVITY_TYPE,
  MIXED_PUBLICITY,
  NO_ACTIVITY_SELECTION,
  parseActivitySettingsUpdate,
  UNSET_ACTIVITY_TYPE,
} from "~/lib/activitySettings"
import type { ParsedActivity } from "~/types/activities"

function activity(overrides: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    id: crypto.randomUUID(),
    name: "walk.gpx",
    startedAtMs: null,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    format: "gpx",
    stats: {
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
    },
    ...overrides,
  }
}

function formData(entries: [string, string][]): FormData {
  const form = new FormData()
  for (const [key, value] of entries) form.append(key, value)
  return form
}

describe("parseActivitySettingsUpdate", () => {
  test("deduplicates repeated activity ids", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["activityId", "one"],
          ["activityId", "two"],
          ["setting", "publicity"],
          ["value", "true"],
        ])
      )
    ).toEqual({
      ok: true,
      activityIds: ["one", "two"],
      setting: "publicity",
      value: true,
    })
  })

  test("parses supported typed values", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "activityType"],
          ["value", "cycling"],
        ])
      )
    ).toEqual({
      ok: true,
      activityIds: ["one"],
      setting: "activityType",
      value: "cycling",
    })
  })

  test("rejects malformed values", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "publicity"],
          ["value", "yes"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid publicity value." })
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "activityType"],
          ["value", "triathlon"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid activity type." })
  })

  test("requires a target and known setting", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["setting", "publicity"],
          ["value", "false"],
        ])
      )
    ).toEqual({ ok: false, error: "At least one activity is required." })
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "unknown"],
          ["value", "false"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid activity setting." })
  })
})

describe("common activity settings", () => {
  test("uses explicit no-selection sentinels", () => {
    expect(commonPublicity([])).toBe(NO_ACTIVITY_SELECTION)
    expect(commonActivityType([])).toBe(NO_ACTIVITY_SELECTION)
  })

  test("returns one activity's values", () => {
    const selected = [activity({ isPublic: true, activityType: "walking" })]
    expect(commonPublicity(selected)).toBe(true)
    expect(commonActivityType(selected)).toBe("walking")
  })

  test("returns common values when selected activities agree", () => {
    const selected = [
      activity({ isPublic: false, activityType: "cycling" }),
      activity({ isPublic: false, activityType: "cycling" }),
    ]
    expect(commonPublicity(selected)).toBe(false)
    expect(commonActivityType(selected)).toBe("cycling")
  })

  test("marks mixed publicity", () => {
    expect(
      commonPublicity([
        activity({ isPublic: false }),
        activity({ isPublic: true }),
      ])
    ).toBe(MIXED_PUBLICITY)
  })

  test("distinguishes unset, equal, and mixed activity types", () => {
    expect(commonActivityType([activity(), activity()])).toBe(
      UNSET_ACTIVITY_TYPE
    )
    expect(
      commonActivityType([
        activity({ activityType: "walking" }),
        activity({ activityType: "running" }),
      ])
    ).toBe(MIXED_ACTIVITY_TYPE)
    expect(
      commonActivityType([activity(), activity({ activityType: "walking" })])
    ).toBe(MIXED_ACTIVITY_TYPE)
  })
})
