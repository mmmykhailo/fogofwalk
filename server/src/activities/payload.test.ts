import { describe, expect, test } from "bun:test"
import { parseActivityUpload } from "./payload"

const stats = {
  distanceKm: 1,
  uniqueDistanceKm: 0,
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

function payload() {
  return {
    name: "cleaned.fit",
    startedAtMs: 0,
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
    format: "fit" as const,
    stats,
    laps: [
      {
        number: 2,
        startIndex: 1,
        endIndex: 3,
        pathRanges: [
          { pathIndex: 0, startIndex: 1, endIndex: 1 },
          { pathIndex: 1, startIndex: 0, endIndex: 1 },
        ],
        startedAtMs: 0,
        stats,
      },
    ],
  }
}

describe("activity upload payload", () => {
  test("accepts structurally valid path-aware lap ranges", () => {
    const result = parseActivityUpload(payload())
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.activity.laps?.[0]?.pathRanges).toHaveLength(2)
  })

  test("rejects non-integer or negative path-aware lap ranges", () => {
    expect(
      parseActivityUpload({
        ...payload(),
        laps: [
          {
            ...payload().laps[0],
            pathRanges: [{ pathIndex: 0.5, startIndex: 0, endIndex: 1 }],
          },
        ],
      }).ok
    ).toBe(false)
    expect(
      parseActivityUpload({
        ...payload(),
        laps: [
          {
            ...payload().laps[0],
            pathRanges: [{ pathIndex: -1, startIndex: 0, endIndex: 1 }],
          },
        ],
      }).ok
    ).toBe(false)
  })
})
