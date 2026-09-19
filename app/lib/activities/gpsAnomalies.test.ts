import { describe, expect, test } from "bun:test"
import type { ActivityType } from "~shared/activities"
import {
  ANOMALY_ALGORITHM_VERSION,
  GPS_ACCURACY_MULTIPLIER,
  LOCAL_DISTANCE_CEILING_M,
  LOCAL_DISTANCE_FLOOR_M,
  LOCAL_DISTANCE_MULTIPLIER,
  MAX_RELIABILITY_EXAMPLES,
  MAX_TRUSTED_GPS_ACCURACY_M,
  MIN_RECOVERY_FRAGMENT_POINTS,
  MIN_CONFIDENT_FRAGMENT_POINTS,
  MIN_RETAINED_PATH_POINTS,
  PAUSE_DRIFT_MAX_WINDOW_POINTS,
  RECOVERY_CONFIRMATION_EDGES,
  REJOIN_CONFIRMATION_EDGES,
  REJOIN_POSITION_CEILING_M,
  REJOIN_POSITION_FLOOR_M,
  RELIABILITY_MIN_BASELINE_EDGES,
  RELIABILITY_WINDOW_EDGES,
  RELATIVE_ACCURACY_FLOOR_M,
  RELATIVE_ACCURACY_MIN_SAMPLES,
  RELATIVE_ACCURACY_MULTIPLIER,
  SHORT_ISLAND_MAX_POINTS,
  SPEED_MISMATCH_COORDINATE_FLOOR_MPS,
  SPEED_MISMATCH_DIFFERENCE_MPS,
  SPEED_MISMATCH_RATIO,
  SPEED_TEST_DISTANCE_FLOOR_M,
  TIME_GAP_CEILING_MS,
  TIME_GAP_FLOOR_MS,
  TIME_GAP_MULTIPLIER,
  maxPlausibleSpeed,
} from "~/constants/activityAnomalies"
import { haversineMeters } from "~/lib/geo"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
} from "./gpsAnomalies"

const METERS_PER_DEGREE = 111_195

function point(
  sourcePointIndex: number,
  xM: number,
  yM = 0,
  timestampMs?: number,
  extras: Pick<AnomalyPoint, "gpsAccuracyM" | "recordedSpeedMps"> = {}
): AnomalyPoint {
  return {
    sourcePointIndex,
    lng: xM / METERS_PER_DEGREE,
    lat: yM / METERS_PER_DEGREE,
    ...(timestampMs == null ? {} : { timestampMs }),
    ...extras,
  }
}

function source(
  points: AnomalyPoint[],
  sourcePathIndex = 0
): AnomalySourcePath {
  return { sourcePathIndex, points }
}

function line(
  positionsM: number[],
  timestampStepMs = 1_000,
  extras: Pick<AnomalyPoint, "gpsAccuracyM" | "recordedSpeedMps">[] = []
): AnomalySourcePath {
  return source(
    positionsM.map((xM, index) =>
      point(index, xM, 0, index * timestampStepMs, extras[index])
    )
  )
}

function indexes(paths: AnomalyPoint[][]): number[][] {
  return paths.map((path) => path.map((item) => item.sourcePointIndex))
}

function baselinePositions(count = 8, stepM = 10): number[] {
  return Array.from({ length: count }, (_, index) => index * stepM)
}

function gapIslandFixture(): AnomalySourcePath {
  const prefix = Array.from({ length: 7 }, (_, index) =>
    point(index, index * 10, 0, index * 1_000, {
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    })
  )
  const entryMs = 7_000 + 47_000
  const returnMs = entryMs + 38_000
  return source([
    ...prefix,
    point(7, 1_452.9, 0, entryMs, {
      gpsAccuracyM: 49.3,
      recordedSpeedMps: 38.8,
    }),
    point(8, -106.4, 0, returnMs, {
      gpsAccuracyM: 4.3,
      recordedSpeedMps: 0.3,
    }),
    point(9, -96.4, 0, returnMs + 1_000, {
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    }),
    point(10, -86.4, 0, returnMs + 2_000, {
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    }),
    point(11, -76.4, 0, returnMs + 3_000, {
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    }),
    point(12, -66.4, 0, returnMs + 4_000, {
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    }),
  ])
}

function recoveredFragmentFixture(): AnomalySourcePath {
  const prefix = Array.from({ length: 6 }, (_, index) =>
    point(index, index * 10, 0, index * 1_000)
  )
  const jumpMs = 5_000 + 26_000
  const gapMs = jumpMs + 1_000 + 2_078_000
  return source([
    ...prefix,
    point(6, 299, jumpMs),
    point(7, 309, jumpMs + 1_000),
    point(8, 593.6, gapMs),
    point(9, 603.6, gapMs + 1_000),
    point(10, 613.6, gapMs + 2_000),
    point(11, 623.6, gapMs + 3_000),
    point(12, 633.6, gapMs + 4_000),
  ])
}

function expectAccounting(
  result: ReturnType<typeof detectGpsAnomalies>,
  sourcePaths: readonly AnomalySourcePath[]
): void {
  expect(result.counts.retainedPoints + result.counts.removedPoints).toBe(
    result.counts.inputPoints
  )
  expect(result.counts.removedPoints).toBeGreaterThanOrEqual(0)
  expect(result.counts.removedPoints).toBeLessThanOrEqual(
    result.counts.inputPoints
  )
  const inputPoints = new Set(sourcePaths.flatMap((source) => source.points))
  const retainedPoints = result.paths.flatMap((path) => path)
  expect(new Set(retainedPoints).size).toBe(retainedPoints.length)
  expect(retainedPoints.every((point) => inputPoints.has(point))).toBe(true)

  const removalExamples = result.examples.filter(
    (example) => example.operation === "remove"
  )
  for (let leftIndex = 0; leftIndex < removalExamples.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < removalExamples.length;
      rightIndex += 1
    ) {
      const left = removalExamples[leftIndex]!
      const right = removalExamples[rightIndex]!
      if (left.sourcePathIndex !== right.sourcePathIndex) continue
      expect(
        left.endPointIndex < right.startPointIndex ||
          right.endPointIndex < left.startPointIndex
      ).toBe(true)
    }
  }
  expect(result.counts.trimmedPrefixPoints).toBeLessThanOrEqual(
    result.counts.removedPoints
  )
  expect(result.counts.trimmedSuffixPoints).toBeLessThanOrEqual(
    result.counts.removedPoints
  )
}

describe("GPS reliability cleaner", () => {
  test("keeps a clean one-hertz track and point provenance", () => {
    const input = line(baselinePositions())
    const result = detectGpsAnomalies([input], { activityType: "walking" })

    expect(result.status).toBe("clean")
    expect(result.paths[0]).toEqual(input.points)
    expect(result.counts).toEqual({
      inputPoints: 8,
      retainedPoints: 8,
      removedPoints: 0,
      emittedPathCount: 1,
      splitCount: 0,
      gapSplitCount: 0,
      removalSplitCount: 0,
      trimmedPrefixPoints: 0,
      trimmedSuffixPoints: 0,
      reasons: {},
    })
    expect(result.work.maxDistanceWindowSize).toBeLessThanOrEqual(
      RELIABILITY_WINDOW_EDGES
    )
    expect(result.work.maxTimeWindowSize).toBeLessThanOrEqual(
      RELIABILITY_WINDOW_EDGES
    )
  })

  test("splits a recording gap, retains both endpoints, and removes no points", () => {
    const positions = [0, 10, 20, 30, 40, 50, 60, 70]
    const points = positions.map((xM, index) =>
      point(index, xM, 0, index < 5 ? index * 1_000 : 45_000 + index * 1_000)
    )
    const result = detectGpsAnomalies([source(points)])

    expect(indexes(result.paths)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7],
    ])
    expect(result.counts).toMatchObject({
      removedPoints: 0,
      splitCount: 1,
      gapSplitCount: 1,
      removalSplitCount: 0,
      reasons: { recording_gap: 1 },
    })
    expect(result.examples[0]).toMatchObject({
      code: "recording_gap",
      operation: "split",
      removedPointCount: 0,
      startPointIndex: 4,
      endPointIndex: 5,
    })
  })

  test("lets a long tunnel gap win over distance and speed rules", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 10, 0, 1_000),
      point(2, 20, 0, 2_000),
      point(3, 30, 0, 3_000),
      point(4, 40, 0, 4_000),
      point(5, 840, 0, 184_000),
      point(6, 850, 0, 185_000),
      point(7, 860, 0, 186_000),
    ]
    const result = detectGpsAnomalies([source(points)])

    expect(indexes(result.paths)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7],
    ])
    expect(result.examples[0]?.code).toBe("recording_gap")
    expect(result.examples[0]?.triggerCode).toBeUndefined()
  })

  test("splits equal and decreasing timestamp edges without fabricating speed", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 10, 0, 1_000),
      point(2, 20, 0, 1_000),
      point(3, 30, 0, 2_000),
      point(4, 40, 0, 2_000),
      point(5, 50, 0, 3_000),
      point(6, 60, 0, 4_000),
      point(7, 70, 0, 5_000),
    ]
    const result = detectGpsAnomalies([source(points)])

    expect(result.counts.reasons.non_positive_time).toBe(2)
    expect(result.counts.gapSplitCount).toBe(0)
    expect(result.counts.removedPoints).toBe(0)
    expect(
      result.examples.filter((item) => item.code === "non_positive_time")
    ).toHaveLength(2)
  })

  test("removes a returning 300 metre one-point spike", () => {
    const positions = [...baselinePositions(6), 350, 60, 70, 80, 90]
    const result = detectGpsAnomalies([line(positions)], {
      activityType: "walking",
    })

    expect(indexes(result.paths)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [7, 8, 9, 10],
    ])
    expect(result.counts.reasons).toEqual({ local_spike: 1 })
    expect(result.counts.removalSplitCount).toBe(1)
    expect(result.examples[0]).toMatchObject({
      code: "local_spike",
      operation: "remove",
      triggerCode: "impossible_speed",
      removedPointCount: 1,
      rejoinPointIndex: 7,
    })
  })

  test("removes a slow local jump even when average speed is plausible", () => {
    const positions = [...baselinePositions(6), 350, 60, 70, 80, 90]
    const points = positions.map((xM, index) =>
      point(index, xM, 0, index < 6 ? index * 10_000 : 60_000 + index * 10_000)
    )
    const result = detectGpsAnomalies([source(points)], {
      activityType: "walking",
    })

    expect(result.counts.reasons.local_spike).toBe(1)
    expect(result.examples[0]?.triggerCode).toBe("local_distance_jump")
    expect(result.counts.removedPoints).toBe(1)
  })

  test("removes a displaced multi-point excursion and trims a displaced suffix", () => {
    const returning = line([...baselinePositions(6), 350, 360, 370, 60, 70, 80])
    const returned = detectGpsAnomalies([returning], {
      activityType: "cycling",
    })
    expect(indexes(returned.paths)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [9, 10, 11],
    ])
    expect(returned.counts.reasons.local_excursion).toBe(1)

    const suffix = detectGpsAnomalies(
      [line([...baselinePositions(6), 350, 360, 370])],
      { activityType: "cycling" }
    )
    expect(indexes(suffix.paths)).toEqual([[0, 1, 2, 3, 4, 5]])
    expect(suffix.counts.reasons.untrusted_suffix).toBe(1)
    expect(suffix.counts.trimmedSuffixPoints).toBe(3)
  })

  test("removes a gap-bounded singleton without bridging either unsafe edge", () => {
    const input = gapIslandFixture()
    const result = detectGpsAnomalies([input], { activityType: "cycling" })

    expect(indexes(result.paths)).toEqual([
      [0, 1, 2, 3, 4, 5, 6],
      [8, 9, 10, 11, 12],
    ])
    expect(result.counts.reasons).toMatchObject({ isolated_fix: 1 })
    expect(result.counts.removedPoints).toBe(1)
    expect(result.work.mergedRemovalRangeCount).toBe(1)
    expect(
      result.examples.some((example) => example.code === "isolated_fix")
    ).toBe(true)
    expectAccounting(result, [input])
  })

  test("recovers a coherent fragment after a long unsupported transition", () => {
    const input = recoveredFragmentFixture()
    const result = detectGpsAnomalies([input], { activityType: "walking" })

    expect(indexes(result.paths)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [8, 9, 10, 11, 12],
    ])
    expect(result.counts.reasons).toMatchObject({
      recovered_fragment: 1,
    })
    expect(result.counts.reasons.untrusted_suffix).toBeUndefined()
    expect(result.work.fragmentPromotions).toBe(1)
    expectAccounting(result, [input])
  })

  test("salvages a clean fragment after an untrusted beginning", () => {
    const points = [
      point(0, 1_000, 0, 0),
      point(1, 10, 0, 1_000),
      point(2, 20, 0, 2_000),
      point(3, 30, 0, 3_000),
      point(4, 40, 0, 4_000),
    ]
    const result = detectGpsAnomalies([source(points)], {
      activityType: "walking",
    })

    expect(indexes(result.paths)).toEqual([[1, 2, 3, 4]])
    expect(result.status).toBe("cleaned")
    expect(result.counts.reasons.untrusted_prefix).toBe(1)
    expect(result.counts.trimmedPrefixPoints).toBe(1)
  })

  test("does not compare separate source paths", () => {
    const first = line(baselinePositions(6))
    const second = source(
      [10_000, 10_010, 10_020, 10_030, 10_040, 10_050].map((xM, index) =>
        point(index, xM)
      ),
      1
    )
    const result = detectGpsAnomalies([first, second], {
      activityType: "walking",
    })

    expect(result.status).toBe("clean")
    expect(result.paths).toHaveLength(2)
    expect(result.paths.map((path) => path.length)).toEqual([6, 6])
  })

  test("quarantines inaccurate FIT fixes and accepts accuracy exactly at the limit", () => {
    const extras = Array.from({ length: 10 }, () => ({}))
    extras[5] = { gpsAccuracyM: MAX_TRUSTED_GPS_ACCURACY_M }
    extras[6] = { gpsAccuracyM: MAX_TRUSTED_GPS_ACCURACY_M + 1 }
    const result = detectGpsAnomalies(
      [line([...baselinePositions(6), 60, 70, 80, 90], 1_000, extras)],
      { activityType: "walking" }
    )

    expect(
      result.paths.flat().map((item) => item.sourcePointIndex)
    ).not.toContain(6)
    expect(result.counts.reasons.untrusted_accuracy).toBe(1)
    expect(result.examples[0]?.operation).toBe("remove")
  })

  test("removes a stationary drift cloud but keeps directional movement", () => {
    const prefix = [point(0, -20), point(1, -10), point(2, 0, 0, 0)]
    const drift = Array.from({ length: 91 }, (_, offset) =>
      point(
        offset + 3,
        [0, 1.5, 0, -1.5][offset % 4]!,
        0,
        1_000 + offset * 1_000
      )
    )
    const suffix = [
      point(94, 10, 0, 92_000),
      point(95, 20, 0, 93_000),
      point(96, 30, 0, 94_000),
    ]
    const result = detectGpsAnomalies([
      source([...prefix, ...drift, ...suffix]),
    ])

    expect(result.counts.reasons.pause_drift).toBe(1)
    expect(result.counts.removedPoints).toBeGreaterThan(20)
    expect(result.paths.length).toBeGreaterThanOrEqual(2)

    const directional = detectGpsAnomalies([
      line(
        Array.from({ length: 100 }, (_, index) => index),
        1_000
      ),
    ])
    expect(directional.counts.reasons.pause_drift).toBeUndefined()
  })

  test("keeps pause detection bounded and diagnostics capped", () => {
    const points = Array.from({ length: 2_500 }, (_, index) =>
      point(index, index * 10, 0, index * 1_000)
    )
    const result = detectGpsAnomalies([source(points)])

    expect(result.work.maxDistanceWindowSize).toBeLessThanOrEqual(
      RELIABILITY_WINDOW_EDGES
    )
    expect(result.work.maxTimeWindowSize).toBeLessThanOrEqual(
      RELIABILITY_WINDOW_EDGES
    )
    expect(result.examples.length).toBeLessThanOrEqual(MAX_RELIABILITY_EXAMPLES)
    expect(result.work.pauseWindowPointsVisited).toBeLessThanOrEqual(2_500)
  })

  test("is idempotent on cleaned output", () => {
    const first = detectGpsAnomalies(
      [line([...baselinePositions(6), 350, 60, 70, 80, 90])],
      { activityType: "cycling" }
    )
    const second = detectGpsAnomalies(
      first.paths.map((points, sourcePathIndex) => ({
        sourcePathIndex,
        points,
      })),
      { activityType: "cycling" }
    )

    expect(second.status).toBe("clean")
    expect(second.paths).toEqual(first.paths)
    expect(second.counts.removedPoints).toBe(0)
  })

  test("uses the shortest antimeridian distance", () => {
    expect(haversineMeters([179.9, 0], [-179.9, 0])).toBeCloseTo(22_239, 0)
  })

  test("keeps the version-2 policy explicit", () => {
    expect(ANOMALY_ALGORITHM_VERSION).toBe(3)
    expect(RELIABILITY_WINDOW_EDGES).toBe(31)
    expect(RELIABILITY_MIN_BASELINE_EDGES).toBe(4)
    expect(LOCAL_DISTANCE_FLOOR_M).toBe(100)
    expect(LOCAL_DISTANCE_MULTIPLIER).toBe(20)
    expect(LOCAL_DISTANCE_CEILING_M).toBe(2_000)
    expect(TIME_GAP_FLOOR_MS).toBe(30_000)
    expect(TIME_GAP_MULTIPLIER).toBe(10)
    expect(TIME_GAP_CEILING_MS).toBe(120_000)
    expect(SPEED_TEST_DISTANCE_FLOOR_M).toBe(100)
    expect(MAX_TRUSTED_GPS_ACCURACY_M).toBe(100)
    expect(GPS_ACCURACY_MULTIPLIER).toBe(4)
    expect(REJOIN_POSITION_FLOOR_M).toBe(100)
    expect(REJOIN_POSITION_CEILING_M).toBe(1_000)
    expect(REJOIN_CONFIRMATION_EDGES).toBe(2)
    expect(RECOVERY_CONFIRMATION_EDGES).toBe(4)
    expect(MIN_RECOVERY_FRAGMENT_POINTS).toBe(5)
    expect(SHORT_ISLAND_MAX_POINTS).toBe(2)
    expect(RELATIVE_ACCURACY_MIN_SAMPLES).toBe(5)
    expect(RELATIVE_ACCURACY_FLOOR_M).toBe(25)
    expect(RELATIVE_ACCURACY_MULTIPLIER).toBe(5)
    expect(SPEED_MISMATCH_COORDINATE_FLOOR_MPS).toBe(5)
    expect(SPEED_MISMATCH_RATIO).toBe(4)
    expect(SPEED_MISMATCH_DIFFERENCE_MPS).toBe(5)
    expect(MIN_RETAINED_PATH_POINTS).toBe(2)
    expect(MIN_CONFIDENT_FRAGMENT_POINTS).toBe(3)
    expect(PAUSE_DRIFT_MAX_WINDOW_POINTS).toBe(600)
    const types: ActivityType[] = [
      "walking",
      "running",
      "cycling",
      "kayaking",
      "swimming",
      "other",
    ]
    expect(types.every((type) => maxPlausibleSpeed(type) > 0)).toBe(true)
  })
})
