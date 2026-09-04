import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { ensureUniqueDistancesCurrent } from "./uniqueDistanceRepair"

function activity(id: string): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
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
  }
}

const stale = { version: 0, activityIds: [] }

describe("ensureUniqueDistancesCurrent", () => {
  test("coalesces concurrent consumers for one library", async () => {
    let calls = 0
    let release!: () => void
    const operation = async () => {
      calls++
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    const activities = [activity("one")]

    const first = ensureUniqueDistancesCurrent(activities, stale, operation)
    const second = ensureUniqueDistancesCurrent(activities, stale, operation)
    expect(first).toBe(second)
    expect(calls).toBe(1)
    release()
    await first
  })

  test("allows a later attempt after a failed repair", async () => {
    let calls = 0
    const activities = [activity("one")]
    const operation = async () => {
      calls++
      if (calls === 1) throw new Error("worker failed")
    }

    await expect(
      ensureUniqueDistancesCurrent(activities, stale, operation)
    ).rejects.toThrow("worker failed")
    await ensureUniqueDistancesCurrent(activities, stale, operation)
    expect(calls).toBe(2)
  })
})
