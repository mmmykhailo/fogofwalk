import { afterAll, describe, expect, test } from "bun:test"

import type { TrackMeta } from "~shared/api"

import { createSqliteFsStore } from "../src/store/sqlite-fs"
import { gzipTrack, makeTrack } from "./helpers"

const tmpDir = `${import.meta.dir}/../.tmp-public-profile-${crypto.randomUUID()}`

describe("public profile legacy metadata", () => {
  test("backfills statistics from an upload saved before stat columns", async () => {
    const store = await createSqliteFsStore(tmpDir)
    const user = await store.upsertUserFromIdentity({
      provider: "github",
      providerUserId: "legacy-stats",
      login: "legacy-stats",
      displayName: "Legacy Stats",
      avatarUrl: null,
      email: null,
    })
    const track = makeTrack({ isPublic: true })
    const blob = gzipTrack(track)
    const meta: TrackMeta = {
      contentHash: "c".repeat(64),
      name: track.name,
      isPublic: true,
      format: track.format,
      startedAtMs: track.startedAtMs,
      distanceKm: track.stats.distanceKm,
      pointCount: track.coordinates.length,
      sizeBytes: blob.byteLength,
      updatedAt: Date.now(),
      durationMs: null,
      movingTimeMs: null,
      elevationGainM: 0,
      avgMovingSpeedKmh: null,
    }
    await store.putTrack(user.id, meta, blob)

    const profile = await store.listPublicTracks(user.id)
    expect(profile.tracks[0]!.durationMs).toBe(track.stats.durationMs)
    expect(profile.tracks[0]!.movingTimeMs).toBe(track.stats.movingTimeMs)
    expect(profile.tracks[0]!.elevationGainM).toBe(track.stats.elevationGainM)
    expect(profile.tracks[0]!.avgMovingSpeedKmh).toBe(
      track.stats.avgMovingSpeedKmh
    )
    expect(
      (await store.getTrack(user.id, meta.contentHash))?.elevationGainM
    ).toBe(track.stats.elevationGainM)
    store.close()
  })
})

afterAll(async () => {
  await Bun.$`rm -rf ${tmpDir}`.quiet().nothrow()
})
