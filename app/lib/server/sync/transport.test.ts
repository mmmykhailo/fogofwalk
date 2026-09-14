import { describe, expect, test } from "bun:test"
import type {
  ActivityMeta,
  ActivityUploadPayload,
  LegacyActivityUploadPayload,
} from "~shared/api"
import {
  parseActivityPayload,
  parseManifestPage,
  isSyncTransportError,
  toActivityUploadPayload,
  validateActivityPayloadHash,
} from "./transport"
import { computeContentHash } from "~/lib/activityHash"
import type { ParsedActivity } from "~/types/activities"

function payload(): LegacyActivityUploadPayload {
  return {
    name: "walk.gpx",
    startedAtMs: 0,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    stats: {
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
    },
  }
}

function meta(contentHash: string): ActivityMeta {
  return {
    contentHash,
    name: "walk.gpx",
    isPublic: false,
    format: "gpx",
    startedAtMs: 0,
    distanceKm: 1,
    pointCount: 2,
    sizeBytes: 100,
    updatedAt: 1,
    durationMs: null,
    movingTimeMs: null,
    elevationGainM: 0,
    avgMovingSpeedKmh: null,
  }
}

describe("sync transport validation", () => {
  function expectSyncTransportError(action: () => unknown): void {
    try {
      action()
    } catch (error) {
      expect(isSyncTransportError(error)).toBe(true)
      return
    }
    throw new Error("Expected a sync transport error")
  }

  test("accepts a valid manifest and rejects malformed rows", () => {
    const hash = "a".repeat(64)
    expect(
      parseManifestPage({
        activities: [meta(hash)],
        deletions: [],
        cursor: 4,
        hasMore: false,
      }).activities[0]
    ).toEqual(meta(hash))

    expectSyncTransportError(() =>
      parseManifestPage({
        activities: [{ ...meta(hash), pointCount: -1 }],
        deletions: [],
        cursor: 4,
        hasMore: false,
      })
    )
  })

  test("validates path/timestamp relationships before returning payloads", () => {
    expect(parseActivityPayload(payload())).toEqual(payload())
    expectSyncTransportError(() =>
      parseActivityPayload({
        ...payload(),
        pointTimestamps: [1],
      })
    )
  })

  test("projects compatibility records to one geometry representation", () => {
    const legacy = payload()
    const modern = {
      ...legacy,
      id: "local-id",
      paths: [legacy.coordinates],
      pathTimestamps: [[0, 1_000]],
    } as ParsedActivity

    const wire = toActivityUploadPayload(modern)

    expect(wire).toMatchObject({
      paths: modern.paths,
      pathTimestamps: modern.pathTimestamps,
      stats: { uniqueDistanceKm: 0 },
    })
    expect("coordinates" in wire).toBe(false)
    expect("pointTimestamps" in wire).toBe(false)
  })

  test("validates path-aware lap ranges against downloaded paths", () => {
    const { coordinates: _coordinates, ...base } = payload()
    const canonical = {
      ...base,
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
      laps: [
        {
          number: 1,
          startIndex: 0,
          endIndex: 1,
          pathRanges: [
            { pathIndex: 0, startIndex: 0, endIndex: 1 },
            { pathIndex: 1, startIndex: 0, endIndex: 1 },
          ],
          startedAtMs: 0,
          stats: payload().stats,
        },
      ],
    } as ActivityUploadPayload

    expect(parseActivityPayload(canonical)).toEqual(canonical)
    expectSyncTransportError(() =>
      parseActivityPayload({
        ...canonical,
        laps: [
          {
            ...canonical.laps![0],
            pathRanges: [{ pathIndex: 4, startIndex: 0, endIndex: 1 }],
          },
        ],
      })
    )
  })

  test("rejects a downloaded body whose geometry does not match the hash", async () => {
    const validPayload = payload()
    const validHash = await computeContentHash({
      ...validPayload,
      id: "remote",
    } as never)
    await expect(
      validateActivityPayloadHash(validHash, validPayload)
    ).resolves.toBeUndefined()
    const failure = await validateActivityPayloadHash(
      "b".repeat(64),
      validPayload
    ).catch((error: unknown) => error)
    expect(isSyncTransportError(failure)).toBe(true)
  })
})
