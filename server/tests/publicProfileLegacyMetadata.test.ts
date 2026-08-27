import { afterAll, describe, expect, test } from "bun:test"

import type { ActivityMeta } from "~shared/api"

import { createSqliteFsStore } from "../src/store/sqlite-fs"
import { gzipActivity, makeActivity } from "./helpers"

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
    const activity = makeActivity({ isPublic: true })
    const blob = gzipActivity(activity)
    const meta: ActivityMeta = {
      contentHash: "c".repeat(64),
      name: activity.name,
      isPublic: true,
      format: activity.format,
      startedAtMs: activity.startedAtMs,
      distanceKm: activity.stats.distanceKm,
      pointCount: activity.coordinates.length,
      sizeBytes: blob.byteLength,
      updatedAt: Date.now(),
      durationMs: null,
      movingTimeMs: null,
      elevationGainM: 0,
      avgMovingSpeedKmh: null,
    }
    await store.putActivity(user.id, meta, blob)

    const profile = await store.listPublicActivities(user.id)
    expect(profile.activities[0]!.durationMs).toBe(activity.stats.durationMs)
    expect(profile.activities[0]!.movingTimeMs).toBe(
      activity.stats.movingTimeMs
    )
    expect(profile.activities[0]!.elevationGainM).toBe(
      activity.stats.elevationGainM
    )
    expect(profile.activities[0]!.avgMovingSpeedKmh).toBe(
      activity.stats.avgMovingSpeedKmh
    )
    expect(
      (await store.getActivity(user.id, meta.contentHash))?.elevationGainM
    ).toBe(activity.stats.elevationGainM)
    store.close()
  })
})

afterAll(async () => {
  await Bun.$`rm -rf ${tmpDir}`.quiet().nothrow()
})
