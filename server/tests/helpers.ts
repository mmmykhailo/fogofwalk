/** Shared fixtures: an app over the memory driver, users, and gzip uploads. */

import type { ActivityStats, ActivityCoords } from "~shared/activities"
import type { ActivityUploadPayload } from "~shared/api"

import { createApp } from "../src/app"
import { createSessionFor } from "../src/auth/session"
import { MemoryStore } from "../src/store/memory"
import type { UserStatus } from "~shared/api"
import { computeContentHash } from "../src/activities/contentHash"

export function makeStats(distanceKm = 4.2): ActivityStats {
  return {
    distanceKm,
    uniqueDistanceKm: 0,
    elevationGainM: 12,
    elevationLossM: 10,
    hasElevation: true,
    durationMs: 1_800_000,
    movingTimeMs: 1_700_000,
    avgPaceMinPerKm: 7.1,
    avgMovingPaceMinPerKm: 6.7,
    avgSpeedKmh: 8.4,
    avgMovingSpeedKmh: 8.9,
    elevationProfile: [{ distanceKm: 0, elevationM: 100 }],
  }
}

export function makeActivity(
  overrides: Partial<ActivityUploadPayload> = {}
): ActivityUploadPayload {
  const coordinates: ActivityCoords = [
    [13.4, 52.5],
    [13.401, 52.501],
    [13.402, 52.502],
  ]
  return {
    name: "Morning run",
    startedAtMs: 1_700_000_000_000,
    coordinates,
    pointTimestamps: [1_700_000_000_000, 1_700_000_001_000, 1_700_000_002_000],
    format: "gpx",
    stats: makeStats(),
    ...overrides,
  }
}

export function gzipActivity(
  activity: ActivityUploadPayload
): Uint8Array<ArrayBuffer> {
  return Bun.gzipSync(new TextEncoder().encode(JSON.stringify(activity)))
}

export function setup() {
  const store = new MemoryStore()
  return { store, app: createApp(store) }
}

export async function signIn(
  store: MemoryStore,
  options: { login?: string; status?: UserStatus; providerUserId?: string } = {}
) {
  const login = options.login ?? "allowed-user"
  const user = await store.upsertUserFromIdentity({
    provider: "github",
    providerUserId: options.providerUserId ?? login,
    login,
    displayName: login,
    avatarUrl: null,
    email: null,
  })
  const status = options.status ?? "allowed"
  const updated = (await store.setUserStatus(user.id, status)) ?? user
  const session = await createSessionFor(store, user.id)
  return { user: updated, token: session.token }
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export async function putActivity(
  app: ReturnType<typeof createApp>,
  token: string,
  activity: ActivityUploadPayload,
  hashOverride?: string
): Promise<Response> {
  const hash = hashOverride ?? (await computeContentHash(activity))
  return app.request(`/api/activities/${hash}`, {
    method: "PUT",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    },
    body: gzipActivity(activity),
  })
}

/** 64 hex digits derived from a number — a plausible content hash for fixtures. */
export function fakeHash(seed: number): string {
  return seed.toString(16).padStart(64, "0")
}
