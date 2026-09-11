import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import type { RawPoint } from "~/types/activities"
import { haversineKm } from "~/lib/stats"
import { smoothTrack } from "./trackSmoothing"

function point(lng: number, lat: number, timestampMs = 1_000): RawPoint {
  return { lng, lat, timestampMs, elevationM: 12 }
}

function untimedPoint(lng: number, lat: number): RawPoint {
  return { lng, lat, timestampMs: undefined, elevationM: 12 }
}

// ~111.195 m per degree of longitude at the equator.
const METRES_PER_DEGREE = 111_195

const TRACK_POINT = /<trkpt\s([^>]*)>([\s\S]*?)<\/trkpt>/g
const ATTRIBUTE = /([a-zA-Z]+)="([^"]*)"/g
const CHILD = /<(ele|time)>([^<]*)<\//g

// Every fixture starts at this point, so a reversed, empty or zero-filled read
// cannot look like a plausible track.
const FIXTURE_ORIGIN = { lat: 52.5, lng: 13.4 }

/**
 * Loads one of the GPX files in `__fixtures__`. Each is a few hundred points
 * lifted out of a real Apple Health export around a GPS artefact, relocated to
 * a neutral origin and re-based to a fixed start time. Recorded geometry is
 * what caught these bugs, and no synthetic track reproduces the way a real
 * receiver loses and regains a fix.
 *
 * Coordinates are read by attribute name. GPX fixes no order for them, and
 * this repo already holds both: Apple Health writes lon first, Garmin and the
 * e2e fixtures write lat first. Reading them by position swaps the two halves
 * of every point on whichever order a matcher was not written for, and the
 * result still parses as a track.
 */
function fixturePoints(name: string): RawPoint[] {
  const xml = readFileSync(
    new URL(`./__fixtures__/${name}.gpx`, import.meta.url),
    "utf8"
  )

  const points = [...xml.matchAll(TRACK_POINT)].map((trackPoint) => {
    const attributes = new Map(
      [...trackPoint[1].matchAll(ATTRIBUTE)].map((a) => [a[1], a[2]])
    )
    const children = new Map(
      [...trackPoint[2].matchAll(CHILD)].map((c) => [c[1], c[2]])
    )

    return {
      lng: Number(attributes.get("lon")),
      lat: Number(attributes.get("lat")),
      elevationM: Number(children.get("ele")),
      timestampMs: Date.parse(children.get("time") ?? ""),
    }
  })

  // A fixture that half reads must never let an assertion succeed on what it
  // failed to parse. Two empty arrays compare equal, an empty track comes back
  // unchanged from anything, and a missing attribute reads as a finite zero.
  expect(points.length).toBeGreaterThan(100)
  expect(points[0].lat).toBeCloseTo(FIXTURE_ORIGIN.lat, 9)
  expect(points[0].lng).toBeCloseTo(FIXTURE_ORIGIN.lng, 9)
  expect(
    points.every(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Number.isFinite(point.elevationM) &&
        Number.isFinite(point.timestampMs)
    )
  ).toBe(true)
  expect(routeLengthKm(points)).toBeGreaterThan(0.1)

  return points
}

function movedPointIndices(before: RawPoint[], after: RawPoint[]): number[] {
  // Comparing only the prefix would let an implementation that drops points
  // report no movement at all.
  expect(after).toHaveLength(before.length)

  const indices: number[] = []
  after.forEach((point, index) => {
    if (point.lng !== before[index].lng || point.lat !== before[index].lat) {
      indices.push(index)
    }
  })
  return indices
}

function peakElevationM(points: RawPoint[]): number {
  return Math.max(...points.map((point) => point.elevationM ?? 0))
}

function routeLengthKm(points: RawPoint[]): number {
  let km = 0
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(
      points[i - 1].lng,
      points[i - 1].lat,
      points[i].lng,
      points[i].lat
    )
  }
  return km
}

describe("smoothTrack", () => {
  test("replaces an isolated GPS spike without changing point alignment", () => {
    const input = [
      point(0.0001, 0),
      point(0.0002, 0),
      point(0.0003, 0),
      point(0.0004, 0),
      point(0, 0),
      point(0, 0),
      point(0, 0),
      point(0.01, 0.01),
      point(0.0005, 0),
      point(0.0006, 0),
      point(0.0007, 0),
      point(0.0008, 0),
      point(0.0009, 0),
      point(0.001, 0),
      point(0.0011, 0),
      point(0.0012, 0),
      point(0.0013, 0),
    ]

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(result[6].lng).toBeCloseTo(0, 12)
    expect(result[6].lat).toBeCloseTo(0, 12)
    expect(result[7].lng).toBeCloseTo(0, 12)
    expect(result[7].lat).toBeCloseTo(0, 12)
    expect(result[8].lng).toBeCloseTo(0.0005, 12)
    expect(result[8].lat).toBeCloseTo(0, 12)
    expect(result[7].elevationM).toBe(12)
    expect(result[7].timestampMs).toBe(1_000)
  })

  test("does not alter a normal short track", () => {
    const input = Array.from({ length: 11 }, (_, i) => point(i * 0.0001, 0))

    expect(smoothTrack(input)).toEqual(input)
  })

  test("ignores valid long intervals after a pause", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const resumeDeg = 400 / METRES_PER_DEGREE
    const walkedForMs = 10 * 10_000
    const pausedForMs = 5 * 60_000
    const input = [
      ...Array.from({ length: 10 }, (_, i) =>
        point(i * stepDeg, 0, i * 10_000)
      ),
      // Recording stops for five minutes and picks up 400 m further on. The
      // clock has to run forwards for this to be the pause it claims to be.
      ...Array.from({ length: 10 }, (_, i) =>
        point(
          9 * stepDeg + resumeDeg + i * stepDeg,
          0,
          walkedForMs + pausedForMs + i * 10_000
        )
      ),
    ]
    const timestamps = input.map((point) => point.timestampMs ?? 0)

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b))
    expect(smoothTrack(input)).toEqual(input)
  })

  test("smooths an excursion whose every leg hides behind a long pause", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const lostForMs = 10 * 60_000
    const input = [
      ...Array.from({ length: 10 }, (_, i) => point(i * stepDeg, 0, i * 1_000)),
      // The fix is lost, reappears 27 km off course, and is lost again. Both
      // legs sit behind a ten-minute gap, so only the speed convicts them.
      point(9 * stepDeg, 0.24, 10_000 + lostForMs),
      ...Array.from({ length: 10 }, (_, i) =>
        point((10 + i) * stepDeg, 0, 10_000 + 2 * lostForMs + i * 1_000)
      ),
    ]

    const result = smoothTrack(input)

    expect(movedPointIndices(input, result)).toEqual([10])
    expect(result[10].lat).toBeCloseTo(0, 12)
    expect(result[10].lng).toBeCloseTo(9 * stepDeg, 12)
  })

  test("keeps a long valid first segment on a track without timestamps", () => {
    const firstSegmentDeg = 333 / METRES_PER_DEGREE
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      untimedPoint(0, 0),
      ...Array.from({ length: 20 }, (_, i) =>
        untimedPoint(firstSegmentDeg + i * stepDeg, 0)
      ),
    ]

    expect(smoothTrack(input)).toEqual(input)
  })

  test("keeps a long valid mid-track interval on a track without timestamps", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const jumpDeg = 500 / METRES_PER_DEGREE
    const input = [
      ...Array.from({ length: 10 }, (_, i) => untimedPoint(i * stepDeg, 0)),
      ...Array.from({ length: 10 }, (_, i) =>
        untimedPoint(9 * stepDeg + jumpDeg + i * stepDeg, 0)
      ),
    ]

    expect(smoothTrack(input)).toEqual(input)
  })

  test("still removes a real spike on a track without timestamps", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = Array.from({ length: 21 }, (_, i) =>
      untimedPoint(i * stepDeg, 0)
    )
    input[10] = untimedPoint(10 * stepDeg, 0.02)

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(result[10].lat).toBeCloseTo(0, 12)
    expect(result[10].lng).toBeCloseTo(9 * stepDeg, 12)
    expect(result[9]).toEqual(input[9])
    expect(result[11]).toEqual(input[11])
  })

  test("pulls back a terminal spike and leaves the penultimate point alone", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      ...Array.from({ length: 20 }, (_, i) => point(i * stepDeg, 0, i * 1_000)),
      point(19 * stepDeg, 0.02, 20_000),
    ]

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(result[20].lat).toBeCloseTo(0, 12)
    expect(result[20].lng).toBeCloseTo(19 * stepDeg, 12)
    expect(result[19]).toEqual(input[19])
    expect(result[18]).toEqual(input[18])
  })

  test("pulls back a leading spike and leaves the second point alone", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      point(0, 0.02, 0),
      ...Array.from({ length: 20 }, (_, i) =>
        point(i * stepDeg, 0, 1_000 + i * 1_000)
      ),
    ]

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(result[0].lat).toBeCloseTo(0, 12)
    expect(result[0].lng).toBeCloseTo(0, 12)
    expect(result[1]).toEqual(input[1])
    expect(result[2]).toEqual(input[2])
  })

  test("keeps a terminal jump that is fast but physically possible", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      ...Array.from({ length: 20 }, (_, i) => point(i * stepDeg, 0, i * 1_000)),
      point(19 * stepDeg + 400 / METRES_PER_DEGREE, 0, 40_000),
    ]

    expect(smoothTrack(input)).toEqual(input)
  })

  test("keeps a terminal jump on a track without timestamps", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      ...Array.from({ length: 20 }, (_, i) => untimedPoint(i * stepDeg, 0)),
      untimedPoint(19 * stepDeg, 0.02),
    ]

    expect(smoothTrack(input)).toEqual(input)
  })

  test("keeps a sparsely sampled loop that returns to where it started", () => {
    const stepDeg = 300 / METRES_PER_DEGREE
    // A stationary warm-up drags the median step to nothing, so the threshold
    // sits on its 250 m floor and every stride of the ride that follows counts
    // as anomalous.
    const input = Array.from({ length: 120 }, (_, i) => point(0, 0, i * 1_000))
    let lng = 0
    let lat = 0
    let elapsedMs = 120_000
    for (const [eastward, northward] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      for (let i = 0; i < 12; i++) {
        lng += eastward * stepDeg
        lat += northward * stepDeg
        elapsedMs += 40_000
        input.push(point(lng, lat, elapsedMs))
      }
    }

    // The loop ends where it began, so its own two ends sit together exactly
    // as a jump-out-and-return would. Only its length tells them apart.
    expect(routeLengthKm(input)).toBeGreaterThan(14)
    expect(smoothTrack(input)).toEqual(input)
  })

  test("pulls back every point of a terminal spike, not just the first", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = [
      ...Array.from({ length: 20 }, (_, i) => point(i * stepDeg, 0, i * 1_000)),
      point(19 * stepDeg, 0.02, 20_000),
      point(19 * stepDeg, -0.02, 21_000),
    ]

    const result = smoothTrack(input)

    expect(movedPointIndices(input, result)).toEqual([20, 21])
    expect(result[20].lat).toBeCloseTo(0, 12)
    expect(result[21].lat).toBeCloseTo(0, 12)
    expect(result[19]).toEqual(input[19])
    expect(routeLengthKm(result)).toBeLessThan(0.5)
  })

  test("carries elevation with the coordinates it replaces", () => {
    const stepDeg = 20 / METRES_PER_DEGREE
    const input = Array.from({ length: 21 }, (_, i) => ({
      lng: i * stepDeg,
      lat: 0,
      timestampMs: i * 1_000,
      elevationM: 100,
    }))
    input[10] = {
      lng: 10 * stepDeg,
      lat: 0.02,
      timestampMs: 10_000,
      elevationM: 16_012,
    }

    const result = smoothTrack(input)

    // An elevation left behind keeps the spike in the climb total and in the
    // profile chart long after the map looks clean.
    expect(result[10].elevationM).toBe(100)
    expect(peakElevationM(result)).toBe(100)
  })

  test("repairs a recorded excursion that resumes after a pause", () => {
    const input = fixturePoints("excursion-after-a-pause")

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(movedPointIndices(input, result)).toEqual([201, 202, 203])
    expect(routeLengthKm(input)).toBeGreaterThan(50)
    expect(routeLengthKm(result)).toBeLessThan(1)
  })

  test("repairs a recorded excursion that lands on the far side of the world", () => {
    const input = fixturePoints("excursion-across-the-globe")

    const result = smoothTrack(input)

    expect(result).toHaveLength(input.length)
    expect(movedPointIndices(input, result)).toEqual([201, 202, 203])
    expect(routeLengthKm(input)).toBeGreaterThan(10_000)
    expect(routeLengthKm(result)).toBeLessThan(3)
    // The strays carried elevations above 15 km; the route runs near 140 m.
    expect(peakElevationM(input)).toBeGreaterThan(15_000)
    expect(peakElevationM(result)).toBeLessThan(200)
    expect(
      result.every(
        (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat)
      )
    ).toBe(true)
  })

  test("repairs a recorded track whose final point spikes", () => {
    const input = fixturePoints("spike-on-the-final-point")
    const last = input.length - 1

    const result = smoothTrack(input)

    expect(movedPointIndices(input, result)).toEqual([last])
    expect(result[last - 1]).toEqual(input[last - 1])
    expect(result[last].lng).toBeCloseTo(input[last - 1].lng, 12)
    expect(result[last].lat).toBeCloseTo(input[last - 1].lat, 12)
  })

  test("repairs a recorded excursion the same way without timestamps", () => {
    const input = fixturePoints("excursion-after-a-pause")
    const untimed = input.map((point) => ({ ...point, timestampMs: undefined }))

    const strayed = movedPointIndices(input, smoothTrack(input))

    expect(strayed).toEqual([201, 202, 203])
    expect(movedPointIndices(untimed, smoothTrack(untimed))).toEqual(strayed)
  })

  test("keeps a recorded terminal spike without timestamps to convict it", () => {
    const recorded = fixturePoints("spike-on-the-final-point")
    const untimed = recorded.map((point) => ({
      ...point,
      timestampMs: undefined,
    }))

    // The spike is still in the geometry; only the speed that proves it is
    // one has gone, so the same track has to come back untouched.
    expect(movedPointIndices(recorded, smoothTrack(recorded))).toEqual([
      recorded.length - 1,
    ])
    expect(smoothTrack(untimed)).toEqual(untimed)
  })
})
