import { describe, expect, test } from "bun:test"
import { buildRawPoints } from "./gpx"

const coords = (count: number, offset = 0): [number, number][] =>
  Array.from({ length: count }, (_, index) => [offset + index * 0.0001, 0])

describe("GPX reliability extensions", () => {
  test("keeps flat sparse accuracy and speed values aligned", () => {
    const points = buildRawPoints(
      coords(8),
      Array.from({ length: 8 }, (_, index) =>
        new Date(index * 1_000).toISOString()
      ),
      {
        hAccs: [3, 3, 3, 3, 3, null, 49.3, 3],
        speeds: [10, 10, 10, 10, 10, null, 0.3, 10],
      }
    )

    expect(points[5]).not.toHaveProperty("gpsAccuracyM")
    expect(points[5]).not.toHaveProperty("recordedSpeedMps")
    expect(points[6]).toMatchObject({
      gpsAccuracyM: 49.3,
      recordedSpeedMps: 0.3,
    })
    expect(points[7]).toMatchObject({
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    })
  })

  test("selects the matching nested MultiLineString segment", () => {
    const points = buildRawPoints(
      coords(4, 20),
      undefined,
      {
        hAccs: [
          [3, 3, 3, 3],
          [null, 101, 3, 3],
        ],
        speeds: [
          [10, 10, 10, 10],
          [null, 0.2, 10, 10],
        ],
      },
      1
    )

    expect(points[0]).not.toHaveProperty("gpsAccuracyM")
    expect(points[1]).toMatchObject({
      gpsAccuracyM: 101,
      recordedSpeedMps: 0.2,
    })
    expect(points[2]).toMatchObject({
      gpsAccuracyM: 3,
      recordedSpeedMps: 10,
    })
  })

  test("ignores malformed and negative extension values", () => {
    const [point] = buildRawPoints(coords(1), undefined, {
      hAccs: ["49.3", -1],
      speeds: [Number.NaN],
    })

    expect(point).not.toHaveProperty("gpsAccuracyM")
    expect(point).not.toHaveProperty("recordedSpeedMps")
  })
})
