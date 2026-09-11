import { describe, expect, test } from "bun:test"
import { toActivityStorageError } from "~/lib/activities/errors"
import {
  isUniqueDistanceRevisionCurrent,
  migrateStoredActivity,
  type StoredActivity,
} from "./storage"

function legacyActivity(): StoredActivity {
  return {
    id: "legacy-id",
    name: "legacy.gpx",
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    pointTimestamps: [Number.NaN, 1234],
    format: "gpx",
    stats: {
      distanceKm: 4.2,
      elevationGainM: 3,
      elevationLossM: 1,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

describe("storage migration seams", () => {
  test("fills legacy activity defaults without mutating the stored record", () => {
    const legacy = legacyActivity()
    const migrated = migrateStoredActivity(legacy)

    expect(migrated).toMatchObject({
      id: "legacy-id",
      startedAtMs: 1234,
      isPublic: false,
      stats: { uniqueDistanceKm: 4.2 },
    })
    expect(legacy).not.toHaveProperty("startedAtMs")
    expect(legacy).not.toHaveProperty("isPublic")
    expect(legacy.stats).not.toHaveProperty("uniqueDistanceKm")
    expect(migrated.coordinates).toEqual(legacy.coordinates)
  })

  test("preserves explicit current-schema values", () => {
    const current = {
      ...legacyActivity(),
      startedAtMs: 9876,
      isPublic: true,
      stats: { ...legacyActivity().stats, uniqueDistanceKm: 1.5 },
    }

    expect(migrateStoredActivity(current)).toMatchObject({
      startedAtMs: 9876,
      isPublic: true,
      stats: { uniqueDistanceKm: 1.5 },
    })
  })

  test("rejects a stale unique-distance write before derived data is saved", () => {
    expect(isUniqueDistanceRevisionCurrent(8, 8)).toBe(true)
    expect(isUniqueDistanceRevisionCurrent(8, 9)).toBe(false)
    expect(isUniqueDistanceRevisionCurrent(8, null)).toBe(false)
    expect(isUniqueDistanceRevisionCurrent(undefined, null)).toBe(true)
  })
})

describe("storage failure classification", () => {
  test.each([
    ["AbortError", "transaction-aborted", true],
    ["QuotaExceededError", "quota", false],
    ["DataCloneError", "serialization", false],
  ] as const)("maps IndexedDB %s to %s", (name, code, retryable) => {
    const error = toActivityStorageError(
      new DOMException("IndexedDB operation failed", name),
      "saving the activity library"
    )

    expect(error).toMatchObject({
      name: "ActivityStorageError",
      code,
      retryable,
    })
  })
})
