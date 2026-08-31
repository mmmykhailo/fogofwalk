import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { gpx } from "@tmcw/togeojson"
import type { RawPoint } from "~/types/activities"
import { smoothTrack } from "./trackSmoothing"

function point(lng: number, lat: number, timestampMs = 1_000): RawPoint {
  return { lng, lat, timestampMs, elevationM: 12 }
}

function fixturePoints(path: string): RawPoint[] {
  const xml = readFileSync(path, "utf8")
  const matches = [
    ...xml.matchAll(/<trkpt[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g),
    ...xml.matchAll(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g),
  ]

  return matches.map((match) => {
    const lonText = match[1] ?? match[2]
    const latText = match[2] ?? match[1]
    const innerXml = match[3]
    const timeText = innerXml.match(/<time>([^<]+)/)?.[1]
    const timestampMs = timeText ? Date.parse(timeText) || undefined : undefined
    const elevationText = innerXml.match(/<ele>([^<]+)/)?.[1]
    const elevationM =
      elevationText != null && elevationText.trim() !== "" && isFinite(Number(elevationText))
        ? Number(elevationText)
        : undefined

    return {
      lat: Number(latText),
      lng: Number(lonText),
      elevationM,
      timestampMs,
    }
  })
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
    const input = [
      point(0, 0, 0),
      ...Array.from({ length: 8 }, (_, i) => point(0.0001 + i * 0.00001, 0, i * 60_000)),
      point(0.0031, 0, 5 * 60_000),
      point(0.0032, 0, 5 * 60_000 + 60_000),
      point(0.0033, 0, 5 * 60_000 + 120_000),
      point(0.0034, 0, 5 * 60_000 + 180_000),
    ]

    expect(smoothTrack(input)).toEqual(input)
  })

  test("handles the provided GPX workout routes without collapsing valid route geometry", () => {
    const fixtureA = fixturePoints(
      "C:\\Users\\vadim\\OneDrive\\Рабочий стол\\workout-routes\\route_2025-07-06_6.56am.gpx"
    )
    const fixtureB = fixturePoints(
      "C:\\Users\\vadim\\OneDrive\\Рабочий стол\\workout-routes\\route_2025-09-06_10.46pm.gpx"
    )

    const smoothedA = smoothTrack(fixtureA)
    const smoothedB = smoothTrack(fixtureB)

    expect(smoothedA).toHaveLength(fixtureA.length)
    expect(smoothedB).toHaveLength(fixtureB.length)
    expect(smoothedA.every((point, index) => point.lng === fixtureA[index].lng && point.lat === fixtureA[index].lat)).toBe(false)
    expect(smoothedB.every((point, index) => point.lng === fixtureB[index].lng && point.lat === fixtureB[index].lat)).toBe(false)
    expect(smoothedA.some((point) => Number.isFinite(point.lng))).toBe(true)
    expect(smoothedB.some((point) => Number.isFinite(point.lat))).toBe(true)
  })
})
