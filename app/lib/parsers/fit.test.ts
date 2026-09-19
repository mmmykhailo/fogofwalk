import { describe, expect, test } from "bun:test"
import type { RawPoint } from "~shared/activities"
import { buildLapActivity } from "~/lib/laps"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
} from "~/lib/activities/gpsAnomalies"
import { buildLapsFromFit, fitRecordToAnomalyPoint } from "./fit"

function point(lng: number, timestampMs?: number): RawPoint {
  return {
    lng,
    lat: 0,
    ...(timestampMs == null ? {} : { timestampMs }),
  }
}

function lap(startMs: number, elapsed = 10) {
  return {
    start_time: startMs,
    total_elapsed_time: elapsed,
    lap_trigger: "distance",
  }
}

describe("FIT lap ranges", () => {
  test("shares adjacent boundaries inside one path", () => {
    const points = [0, 0.001, 0.002, 0.003, 0.004, 0.005].map((lng, i) =>
      point(lng, i * 1_000)
    )
    const laps = buildLapsFromFit(points, [lap(0), lap(3_000)])

    expect(
      laps?.map(({ number, startIndex, endIndex, pathRanges }) => ({
        number,
        startIndex,
        endIndex,
        pathRanges,
      }))
    ).toEqual([
      {
        number: 1,
        startIndex: 0,
        endIndex: 2,
        pathRanges: [{ pathIndex: 0, startIndex: 0, endIndex: 2 }],
      },
      {
        number: 2,
        startIndex: 2,
        endIndex: 5,
        pathRanges: [{ pathIndex: 0, startIndex: 2, endIndex: 5 }],
      },
    ])
  })

  test("never creates a range across a cleaned path gap", () => {
    const paths = [
      [
        point(0, 0),
        point(0.001, 1_000),
        point(0.002, 2_000),
        point(0.003, 3_000),
      ],
      [point(10, 3_000), point(10.001, 4_000), point(10.002, 5_000)],
    ]
    const laps = buildLapsFromFit(paths, [lap(0), lap(3_000, 99)])

    expect(laps).toHaveLength(2)
    expect(laps?.[0]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[1]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 2, endIndex: 3 },
      { pathIndex: 1, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[1]?.stats.durationMs).toBe(3_000)
  })

  test("keeps the active lap across retained paths with undated points", () => {
    const paths = [
      [
        point(0, 0),
        point(0.001, 1_000),
        point(0.002, 2_000),
        point(0.003, 3_000),
      ],
      [point(10), point(10.001), point(10.002, 5_000)],
    ]
    const laps = buildLapsFromFit(paths, [lap(0), lap(3_000)])

    expect(laps).toHaveLength(2)
    expect(laps?.[0]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[1]?.pathRanges).toEqual([
      { pathIndex: 0, startIndex: 2, endIndex: 3 },
      { pathIndex: 1, startIndex: 0, endIndex: 2 },
    ])
    expect(laps?.[0]?.stats.distanceKm).toBeCloseTo(0.222, 2)
    expect(laps?.[1]?.stats.distanceKm).toBeCloseTo(0.333, 2)
    expect(laps?.[1]?.stats.distanceKm).toBeLessThan(1)
  })

  test("starts an initially undated path in lap 1", () => {
    const paths = [
      [point(0), point(0.001), point(0.002, 3_000), point(0.003, 4_000)],
    ]
    const laps = buildLapsFromFit(paths, [lap(0), lap(3_000)])

    expect(
      laps?.map(({ number, pathRanges }) => ({ number, pathRanges }))
    ).toEqual([
      {
        number: 1,
        pathRanges: [{ pathIndex: 0, startIndex: 0, endIndex: 1 }],
      },
      {
        number: 2,
        pathRanges: [{ pathIndex: 0, startIndex: 1, endIndex: 3 }],
      },
    ])
  })

  test("drops laps reduced below two retained points", () => {
    const paths = [
      [point(0, 0), point(0.001, 1_000)],
      [point(10, 2_000), point(10.001, 3_000)],
    ]
    const laps = buildLapsFromFit(paths, [lap(0), lap(2_000), lap(3_000)])

    expect(laps).toBeUndefined()
  })

  test("builds a synthetic lap activity from path ranges", () => {
    const activity = {
      id: "activity",
      name: "ride.fit",
      startedAtMs: 0,
      coordinates: [
        [0, 0],
        [0.001, 0],
        [10, 0],
        [10.001, 0],
      ] as [number, number][],
      paths: [
        [
          [0, 0],
          [0.001, 0],
        ],
        [
          [10, 0],
          [10.001, 0],
        ],
      ] as [number, number][][],
      pathTimestamps: [
        [0, 1_000],
        [3_000, 4_000],
      ],
      format: "fit" as const,
      stats: {
        distanceKm: 1,
        uniqueDistanceKm: 1,
        elevationGainM: 0,
        elevationLossM: 0,
        hasElevation: false,
        durationMs: 4_000,
        movingTimeMs: 2_000,
        avgPaceMinPerKm: null,
        avgMovingPaceMinPerKm: null,
        avgSpeedKmh: null,
        avgMovingSpeedKmh: null,
        elevationProfile: [],
      },
    }
    const lapData = {
      number: 1,
      startIndex: 0,
      endIndex: 1,
      pathRanges: [
        { pathIndex: 0, startIndex: 0, endIndex: 1 },
        { pathIndex: 1, startIndex: 0, endIndex: 1 },
      ],
      startedAtMs: 0,
      stats: activity.stats,
    }

    const result = buildLapActivity(activity, lapData)

    expect(result.paths).toEqual([
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [10, 0],
        [10.001, 0],
      ],
    ])
    expect(result.pathTimestamps).toEqual([
      [0, 1_000],
      [3_000, 4_000],
    ])
    expect(result.coordinates).toHaveLength(4)
  })
})

describe("FIT reliability signals", () => {
  test("preserves finite non-negative optional signals", () => {
    const point = fitRecordToAnomalyPoint(
      {
        position_long: 14,
        position_lat: 50,
        timestamp: new Date(1_000),
        enhanced_altitude: 123.4,
        enhanced_speed: 2.5,
        gps_accuracy: 8,
      },
      17
    )

    expect(point).toEqual({
      sourcePointIndex: 17,
      lng: 14,
      lat: 50,
      timestampMs: 1_000,
      elevationM: 123.4,
      recordedSpeedMps: 2.5,
      gpsAccuracyM: 8,
    })
  })

  test("omits absent, negative, non-finite, and malformed optional signals", () => {
    const point = fitRecordToAnomalyPoint(
      {
        position_long: 14,
        position_lat: 50,
        timestamp: "not-a-date",
        altitude: "bad",
        speed: -1,
        gps_accuracy: Number.NaN,
      },
      2
    )

    expect(point).toEqual({
      sourcePointIndex: 2,
      lng: 14,
      lat: 50,
    })
  })

  test("coordinate-derived impossibility wins over a contradictory low device speed", () => {
    const points = [
      { lng: 0, lat: 0, timestampMs: 0, recordedSpeedMps: 0 },
      { lng: 0.0001, lat: 0, timestampMs: 1_000, recordedSpeedMps: 0 },
      { lng: 0.0002, lat: 0, timestampMs: 2_000, recordedSpeedMps: 0 },
      { lng: 0.0003, lat: 0, timestampMs: 3_000, recordedSpeedMps: 0 },
      { lng: 0.0004, lat: 0, timestampMs: 4_000, recordedSpeedMps: 0 },
      { lng: 0.0035, lat: 0, timestampMs: 5_000, recordedSpeedMps: 0 },
      { lng: 0.0005, lat: 0, timestampMs: 6_000, recordedSpeedMps: 0 },
      { lng: 0.0006, lat: 0, timestampMs: 7_000, recordedSpeedMps: 0 },
      { lng: 0.0007, lat: 0, timestampMs: 8_000, recordedSpeedMps: 0 },
    ].map((record, sourcePointIndex) => ({
      ...record,
      sourcePointIndex,
    }))
    const result = detectGpsAnomalies([{ sourcePathIndex: 0, points }], {
      activityType: "walking",
    })

    expect(result.counts.reasons.local_spike).toBe(1)
    expect(result.examples[0]?.triggerCode).toBe("impossible_speed")
  })

  for (const withSensors of [false, true]) {
    test(`recovers a reliable fragment ${withSensors ? "with" : "without"} optional sensors`, () => {
      const positions = [
        0, 10, 20, 30, 40, 50, 299, 309, 593.6, 603.6, 613.6, 623.6, 633.6,
      ]
      const points: AnomalyPoint[] = positions.map((xM, sourcePointIndex) => {
        const timestampMs =
          sourcePointIndex < 6
            ? sourcePointIndex * 1_000
            : sourcePointIndex === 6
              ? 31_000
              : sourcePointIndex === 7
                ? 32_000
                : 2_110_000 + (sourcePointIndex - 8) * 1_000
        return {
          sourcePointIndex,
          lng: xM / 111_195,
          lat: 0,
          timestampMs,
          ...(withSensors ? { gpsAccuracyM: 3, recordedSpeedMps: 10 } : {}),
        }
      })
      const result = detectGpsAnomalies([{ sourcePathIndex: 0, points }], {
        activityType: "walking",
      })

      expect(
        result.paths.map((path) => path.map((point) => point.sourcePointIndex))
      ).toEqual([
        [0, 1, 2, 3, 4, 5],
        [8, 9, 10, 11, 12],
      ])
      expect(result.counts.removedPoints).toBe(2)
      expect(result.counts.reasons.recovered_fragment).toBe(1)
      expect(result.counts.reasons.untrusted_suffix).toBeUndefined()
      expect(result.work.fragmentPromotions).toBe(1)
    })
  }
})
