import { describe, expect, test } from "bun:test"
import type { ActivityType } from "~shared/activities"
import {
  ABSOLUTE_TELEPORT_DISTANCE_M,
  MAX_ANOMALY_EXAMPLES,
  MIN_SPEED_TEST_DISTANCE_M,
  REJOIN_POSITION_MARGIN_M,
  maxPlausibleSpeed,
} from "~/constants/activityAnomalies"
import { haversineMeters } from "~/lib/geo"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
} from "./gpsAnomalies"

function point(
  sourcePointIndex: number,
  lng: number,
  timestampMs?: number
): AnomalyPoint {
  return {
    sourcePointIndex,
    lng,
    lat: 0,
    ...(timestampMs == null ? {} : { timestampMs }),
  }
}

function path(
  longitudes: number[],
  timestampStepMs = 1_000
): AnomalySourcePath {
  return {
    sourcePathIndex: 0,
    points: longitudes.map((lng, index) =>
      point(index, lng, index * timestampStepMs)
    ),
  }
}

function baseline(count = 5): number[] {
  return Array.from({ length: count }, (_, index) => index * 0.0001)
}

describe("GPS anomaly detector", () => {
  test("uses the shortest antimeridian distance", () => {
    expect(haversineMeters([179.9, 0], [-179.9, 0])).toBeCloseTo(22_239, 0)
  })

  test("preserves a clean path and its point object provenance", () => {
    const input = path(baseline(8))
    const result = detectGpsAnomalies([input], { activityType: "walking" })

    expect(result.status).toBe("clean")
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]).toEqual(input.points)
    expect(result.paths[0]?.map((item) => item.sourcePointIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect(result.counts).toEqual({
      inputPoints: 8,
      retainedPoints: 8,
      removedPoints: 0,
      splitCount: 0,
      trimmedPrefixPoints: 0,
      trimmedSuffixPoints: 0,
      reasons: {},
    })
  })

  test("removes a one-point excursion only after a snap-back and lookahead", () => {
    const input = path([...baseline(), 10, 0.0005, 0.0006, 0.0007, 0.0008])
    const result = detectGpsAnomalies([input], { activityType: "cycling" })

    expect(result.status).toBe("cleaned")
    expect(
      result.paths.map((items) => items.map((item) => item.sourcePointIndex))
    ).toEqual([
      [0, 1, 2, 3, 4],
      [6, 7, 8, 9],
    ])
    expect(result.counts).toMatchObject({
      retainedPoints: 9,
      removedPoints: 1,
      splitCount: 1,
      reasons: { teleport_spike: 1 },
    })
    expect(result.examples[0]).toMatchObject({
      code: "teleport_spike",
      startPointIndex: 5,
      endPointIndex: 5,
      rejoinPointIndex: 6,
    })
  })

  test("removes a returning block as one excursion", () => {
    const input = path([
      ...baseline(),
      10,
      10.0001,
      10.0002,
      0.0005,
      0.0006,
      0.0007,
    ])
    const result = detectGpsAnomalies([input], { activityType: "cycling" })

    expect(
      result.paths.map((items) => items.map((item) => item.sourcePointIndex))
    ).toEqual([
      [0, 1, 2, 3, 4],
      [8, 9, 10],
    ])
    expect(result.counts.reasons).toEqual({ teleport_excursion: 1 })
    expect(result.examples[0]).toMatchObject({
      startPointIndex: 5,
      endPointIndex: 7,
      rejoinPointIndex: 8,
    })
  })

  test("trims a corrupt suffix after a trusted prefix", () => {
    const input = path([...baseline(), 10, 10.0001, 10.0002, 10.0003])
    const result = detectGpsAnomalies([input], { activityType: "walking" })

    expect(
      result.paths.map((items) => items.map((item) => item.sourcePointIndex))
    ).toEqual([[0, 1, 2, 3, 4]])
    expect(result.counts).toMatchObject({
      retainedPoints: 5,
      removedPoints: 4,
      trimmedSuffixPoints: 4,
      reasons: { teleport_tail: 1 },
    })
    expect(result.examples[0]).toMatchObject({
      code: "teleport_tail",
      startPointIndex: 5,
      endPointIndex: 8,
      rejoinPointIndex: null,
    })
  })

  test("does not accept a locally coherent false stream without a candidate exit", () => {
    const input = path([...baseline(), 10, 10.0001, 10.0002, 10.0003])
    const result = detectGpsAnomalies([input], { activityType: "cycling" })

    expect(result.paths.flat().map((item) => item.sourcePointIndex)).toEqual([
      0, 1, 2, 3, 4,
    ])
    expect(result.examples[0]?.code).toBe("teleport_tail")
  })

  test("reports a leading discontinuity as ambiguous", () => {
    const result = detectGpsAnomalies(
      [path([0, 10, 10.0001, 10.0002, 10.0003, 10.0004])],
      { activityType: "cycling" }
    )

    expect(result.status).toBe("ambiguous")
    expect(result.counts.reasons).toEqual({ ambiguous_discontinuity: 1 })
    expect(result.paths).toHaveLength(0)
    expect(result.examples[0]).toMatchObject({
      code: "ambiguous_discontinuity",
      startPointIndex: 1,
    })
  })

  test("never compares separate source paths", () => {
    const first = path(baseline(6))
    const second = {
      sourcePathIndex: 1,
      points: [10, 10.0001, 10.0002, 10.0003, 10.0004, 10.0005].map(
        (lng, index) => point(index, lng)
      ),
    }
    const result = detectGpsAnomalies([first, second], {
      activityType: "walking",
    })

    expect(result.status).toBe("clean")
    expect(result.paths).toHaveLength(2)
    expect(result.paths.map((items) => items.length)).toEqual([6, 6])
  })

  test("keeps plausible long timestamped travel", () => {
    const speed = maxPlausibleSpeed("cycling")
    const travelDistanceM = speed * 3_600
    const travelDegrees = travelDistanceM / 111_195
    const result = detectGpsAnomalies(
      [path([0, 0.0001, 0.0002, travelDegrees], 3_600_000)],
      { activityType: "cycling" }
    )

    expect(result.status).toBe("clean")
    expect(result.counts.removedPoints).toBe(0)
  })

  test("requires physically plausible confirmation below the entry floor", () => {
    const input = path([
      ...baseline(),
      10,
      0.0005,
      0.008,
      0.0007,
      0.0008,
      0.0009,
    ])
    const result = detectGpsAnomalies([input], { activityType: "walking" })

    expect(result.counts.reasons).toEqual({ teleport_tail: 1 })
    expect(result.paths.flat().map((item) => item.sourcePointIndex)).toEqual([
      0, 1, 2, 3, 4,
    ])
  })

  test("splits invalid coordinates before anomaly analysis", () => {
    const source = {
      sourcePathIndex: 3,
      points: [
        point(0, 0),
        point(1, 0.0001),
        point(2, Number.NaN),
        point(3, 10),
        point(4, 10.0001),
      ],
    }
    const result = detectGpsAnomalies([source])

    expect(result.status).toBe("cleaned")
    expect(
      result.paths.map((items) => items.map((item) => item.sourcePointIndex))
    ).toEqual([
      [0, 1],
      [3, 4],
    ])
    expect(result.counts.removedPoints).toBe(1)
  })

  test("caps examples while keeping exact removal counts", () => {
    const values: number[] = []
    for (let excursion = 0; excursion < MAX_ANOMALY_EXAMPLES + 2; excursion++) {
      values.push(...baseline(5))
      values.push(10 + excursion)
      values.push(excursion + 0.0005)
      values.push(excursion + 0.0006)
      values.push(excursion + 0.0007)
    }
    values.push(...baseline(5))
    const result = detectGpsAnomalies([path(values)], {
      activityType: "cycling",
    })

    expect(result.examples.length).toBeLessThanOrEqual(MAX_ANOMALY_EXAMPLES)
    expect(
      (result.counts.reasons.teleport_spike ?? 0) +
        (result.counts.reasons.teleport_excursion ?? 0) +
        (result.counts.reasons.teleport_tail ?? 0)
    ).toBeGreaterThan(MAX_ANOMALY_EXAMPLES)
  })

  test("is idempotent on cleaned output", () => {
    const first = detectGpsAnomalies(
      [path([...baseline(), 10, 0.0005, 0.0006, 0.0007])],
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

  test("keeps threshold constants explicit", () => {
    expect(MIN_SPEED_TEST_DISTANCE_M).toBe(1_000)
    expect(ABSOLUTE_TELEPORT_DISTANCE_M).toBe(250_000)
    expect(REJOIN_POSITION_MARGIN_M).toBe(250)
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
