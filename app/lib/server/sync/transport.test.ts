import { describe, expect, test } from "bun:test"
import type { ActivityMeta, ActivityUploadPayload } from "~shared/api"
import {
  parseActivityPayload,
  parseManifestPage,
  isSyncTransportError,
  validateActivityPayloadHash,
} from "./transport"
import { computeContentHash } from "~/lib/activityHash"

function payload(): ActivityUploadPayload {
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
