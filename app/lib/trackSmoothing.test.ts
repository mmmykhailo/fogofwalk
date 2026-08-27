import { describe, expect, test } from "bun:test"
import type { RawPoint } from "~/types/activities"
import { smoothTrack } from "./trackSmoothing"

function point(lng: number, lat: number): RawPoint {
  return { lng, lat, timestampMs: 1_000, elevationM: 12 }
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
    expect(result[7].lng).toBeCloseTo(0.0005)
    expect(result[7].lat).toBeCloseTo(0)
    expect(result[7].elevationM).toBe(12)
    expect(result[7].timestampMs).toBe(1_000)
  })

  test("does not alter a normal short track", () => {
    const input = Array.from({ length: 11 }, (_, i) => point(i * 0.0001, 0))

    expect(smoothTrack(input)).toEqual(input)
  })
})
