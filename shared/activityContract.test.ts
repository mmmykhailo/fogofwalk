import { describe, expect, test } from "bun:test"

import {
  flattenActivityPaths,
  normalizeActivityGeometry,
} from "./activityContract"
import {
  canonicalActivityIdentityString,
  ACTIVITY_IDENTITY_VERSION,
} from "./activityIdentity"

describe("activity geometry contract", () => {
  test("wraps legacy coordinates as one path", () => {
    const result = normalizeActivityGeometry({
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    })

    expect(result).toEqual({
      ok: true,
      geometry: {
        paths: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      },
      warnings: [],
    })
  })

  test("preserves disconnected paths and never bridges invalid points", () => {
    const result = normalizeActivityGeometry({
      paths: [
        [
          [1, 1],
          [Number.NaN, 2],
          [1.1, 1.1],
          [1.2, 1.2],
        ],
        [
          [2, 2],
          [2.1, 2.1],
        ],
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.paths).toEqual([
      [
        [1.1, 1.1],
        [1.2, 1.2],
      ],
      [
        [2, 2],
        [2.1, 2.1],
      ],
    ])
    expect(result.warnings.map(({ code }) => code)).toEqual([
      "dropped_invalid_point",
      "dropped_path",
    ])
  })

  test("coalesces duplicates while retaining timestamp alignment", () => {
    const result = normalizeActivityGeometry({
      paths: [
        [
          [0, 0],
          [0, 0],
          [1, 1],
        ],
      ],
      pathTimestamps: [[100, 101, null]],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry).toEqual({
      paths: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
      pathTimestamps: [[100, null]],
    })
  })

  test("rejects missing, invalid, and misaligned geometry", () => {
    expect(normalizeActivityGeometry({}).ok).toBe(false)
    expect(
      normalizeActivityGeometry({
        paths: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
        pathTimestamps: [[1]],
      })
    ).toMatchObject({ ok: false, error: { code: "timestamp_mismatch" } })
    expect(normalizeActivityGeometry({ coordinates: [[0, 0]] })).toMatchObject({
      ok: false,
      error: { code: "insufficient_points" },
    })
  })

  test("accepts Null Island and exposes an explicit flattening helper", () => {
    const paths = [
      [
        [0, 0],
        [0.1, 0.1],
      ],
      [
        [10, 10],
        [10.1, 10.1],
      ],
    ] as [[number, number], [number, number]][]
    expect(normalizeActivityGeometry({ paths }).ok).toBe(true)
    expect(flattenActivityPaths(paths)).toEqual([
      [0, 0],
      [0.1, 0.1],
      [10, 10],
      [10.1, 10.1],
    ])
  })
})

describe("activity identity contract", () => {
  test("includes version, path count, lengths, and boundaries", () => {
    const separated = canonicalActivityIdentityString({
      format: "gpx",
      startedAtMs: 42,
      paths: [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ],
    })
    const flattened = canonicalActivityIdentityString({
      format: "gpx",
      startedAtMs: 42,
      paths: [
        [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      ],
    })

    expect(separated.startsWith(`v${ACTIVITY_IDENTITY_VERSION}|`)).toBe(true)
    expect(separated).not.toBe(flattened)
    expect(separated).toContain("|2|2:")
  })

  test("keeps the legacy flat serialization byte-compatible", () => {
    expect(
      canonicalActivityIdentityString({
        format: "fit",
        startedAtMs: null,
        coordinates: [[-0, 0]],
      })
    ).toBe("fit||1|0.000000,0.000000")
  })
})
