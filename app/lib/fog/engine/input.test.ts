import { describe, expect, test } from "bun:test"
import type { CanonicalActivity, ParsedActivity } from "~shared/activities"
import {
  FOG_INPUT_DEFAULTS,
  sanitizeFogInput,
  type FogGeometryInput,
} from "./input"

function geometry(
  paths: [number, number][][],
  pathTimestamps?: (number | null)[][]
): FogGeometryInput {
  return pathTimestamps === undefined ? { paths } : { paths, pathTimestamps }
}

function legacyActivity(coordinates: [number, number][]): ParsedActivity {
  return {
    id: "legacy",
    name: "Legacy",
    startedAtMs: null,
    coordinates,
    format: "gpx",
    stats: {
      distanceKm: 0,
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
    },
  }
}

describe("fog input sanitizer", () => {
  test("accepts legacy geometry and preserves canonical disconnected paths", () => {
    const legacy = sanitizeFogInput(
      legacyActivity([
        [14, 50],
        [14.001, 50.001],
      ])
    )
    expect(legacy.rejected).toBe(false)
    expect(legacy.paths).toEqual([
      [
        [14, 50],
        [14.001, 50.001],
      ],
    ])

    const canonical: CanonicalActivity = {
      ...legacyActivity([]),
      paths: [
        [
          [14, 50],
          [14.001, 50.001],
        ],
        [
          [15, 50],
          [15.001, 50.001],
        ],
      ],
    }
    const result = sanitizeFogInput(canonical)
    expect(result.rejected).toBe(false)
    expect(result.paths).toHaveLength(2)
    expect(result.paths[0][1]).toEqual([14.001, 50.001])
    expect(result.paths[1][0]).toEqual([15, 50])
  })

  test("preserves cleaned path timestamps without creating a bridge", () => {
    const result = sanitizeFogInput(
      geometry(
        [
          [
            [14, 50],
            [14.001, 50],
          ],
          [
            [15, 50],
            [15.001, 50],
          ],
        ],
        [
          [1_000, 2_000],
          [60_000, 61_000],
        ]
      )
    )

    expect(result.rejected).toBe(false)
    expect(result.paths).toHaveLength(2)
    expect(result.pathTimestamps).toEqual([
      [1_000, 2_000],
      [60_000, 61_000],
    ])
    expect(result.warnings).toEqual([])
  })

  test("drops invalid points by splitting, without connecting the remaining pieces", () => {
    const result = sanitizeFogInput(
      geometry([
        [
          [14, 50],
          [Number.NaN, 50],
          [14.01, 50],
          [14.02, 50],
        ],
      ])
    )

    expect(result.rejected).toBe(false)
    expect(result.paths).toEqual([
      [
        [14.01, 50],
        [14.02, 50],
      ],
    ])
    expect(result.warnings.map(({ code }) => code)).toContain(
      "dropped_invalid_point"
    )
    expect(result.warnings.map(({ code }) => code)).toContain("dropped_path")
  })

  test("coalesces exact and near duplicates while retaining the first timestamp", () => {
    const result = sanitizeFogInput(
      geometry(
        [
          [
            [14, 50],
            [14.000001, 50],
            [14, 50],
            [14.01, 50],
          ],
        ],
        [[100, 200, 300, 400]]
      )
    )

    expect(result.rejected).toBe(false)
    expect(result.paths).toEqual([
      [
        [14, 50],
        [14.01, 50],
      ],
    ])
    expect(result.pathTimestamps).toEqual([[100, 400]])
    expect(
      result.warnings.filter(({ code }) => code === "coalesced_duplicate_point")
    ).toHaveLength(2)
    expect(result.warningCounts.coalesced_duplicate_point).toBe(2)
  })

  test("bounds warning examples while retaining every coalesced event count", () => {
    const duplicateCount = 20_000
    const result = sanitizeFogInput(
      geometry([
        [
          [14, 50],
          ...Array.from(
            { length: duplicateCount },
            () => [14, 50] as [number, number]
          ),
          [14.01, 50],
        ],
      ])
    )

    expect(result.rejected).toBe(false)
    expect(result.warningCounts.coalesced_duplicate_point).toBe(duplicateCount)
    expect(result.warnings.length).toBeLessThanOrEqual(16)
  })

  test("splits an implausible teleport into independent paths", () => {
    const result = sanitizeFogInput(
      geometry([
        [
          [14, 50],
          [14.01, 50],
          [15, 50],
          [15.01, 50],
        ],
      ]),
      { teleportThresholdMeters: 20_000, activitySimplifyToleranceDegrees: 0 }
    )

    expect(result.rejected).toBe(false)
    expect(result.paths).toEqual([
      [
        [14, 50],
        [14.01, 50],
      ],
      [
        [15, 50],
        [15.01, 50],
      ],
    ])
    expect(result.warnings.map(({ code }) => code)).toContain("split_teleport")
  })

  test("splits antimeridian crossings and unwrapped longitudes locally", () => {
    const wrapped = sanitizeFogInput(
      geometry([
        [
          [179, 0],
          [-179, 0],
        ],
      ]),
      { activitySimplifyToleranceDegrees: 0 }
    )
    const unwrapped = sanitizeFogInput(
      geometry([
        [
          [179, 0],
          [181, 0],
        ],
      ]),
      { activitySimplifyToleranceDegrees: 0 }
    )

    for (const result of [wrapped, unwrapped]) {
      expect(result.rejected).toBe(false)
      expect(result.paths).toEqual([
        [
          [179, 0],
          [180, 0],
        ],
        [
          [-180, 0],
          [-179, 0],
        ],
      ])
      expect(result.warnings.map(({ code }) => code)).toContain(
        "split_antimeridian"
      )
      for (const path of result.paths) {
        expect(Math.abs(path[1][0] - path[0][0])).toBeLessThanOrEqual(1)
      }
    }
  })

  test("does not turn equivalent seam endpoints into a 360-degree edge", () => {
    const result = sanitizeFogInput(
      geometry([
        [
          [180, 0],
          [-180, 1],
        ],
      ]),
      { activitySimplifyToleranceDegrees: 0 }
    )

    expect(result.rejected).toBe(false)
    expect(result.paths).toEqual([
      [
        [180, 0],
        [180, 1],
      ],
    ])
  })

  test("clamps pole-adjacent points to the projection limit", () => {
    const result = sanitizeFogInput(
      geometry([
        [
          [0, 89],
          [1, 89],
        ],
      ]),
      { activitySimplifyToleranceDegrees: 0 }
    )

    expect(result.rejected).toBe(false)
    expect(result.paths[0][0][1]).toBe(FOG_INPUT_DEFAULTS.maxLatitude)
    expect(result.paths[0][1][1]).toBe(FOG_INPUT_DEFAULTS.maxLatitude)
    expect(result.warnings.map(({ code }) => code)).toEqual([
      "clamped_latitude",
      "clamped_latitude",
    ])
  })

  test("reduces dense paths to the technical point budget and keeps endpoints", () => {
    const dense: [number, number][] = Array.from({ length: 20 }, (_, index) => [
      14 + index * 0.001,
      50,
    ])
    const result = sanitizeFogInput(geometry([dense]), {
      activitySimplifyToleranceDegrees: 0,
      maxPointsPerPath: 5,
    })

    expect(result.rejected).toBe(false)
    expect(result.paths[0]).toHaveLength(5)
    expect(result.paths[0][0]).toEqual(dense[0])
    expect(result.paths[0][4]).toEqual(dense[19])
    expect(result.warnings.map(({ code }) => code)).toContain(
      "point_budget_exceeded"
    )
  })

  test("rejects unusable geometry and misaligned timestamps", () => {
    expect(sanitizeFogInput(geometry([[[14, 50]]]))).toMatchObject({
      rejected: true,
      reason: "no_usable_paths",
    })
    expect(
      sanitizeFogInput(
        geometry(
          [
            [
              [14, 50],
              [14.01, 50],
            ],
          ],
          [[100]]
        )
      )
    ).toMatchObject({
      rejected: true,
      reason: "invalid_timestamps",
    })
  })

  test("uses the activity input tolerance independently from emission tolerance", () => {
    expect(FOG_INPUT_DEFAULTS.activitySimplifyToleranceDegrees).toBe(0.0005)
    expect(FOG_INPUT_DEFAULTS.activitySimplifyToleranceDegrees).not.toBe(0.0001)
  })
})
