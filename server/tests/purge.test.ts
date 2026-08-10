import { beforeEach, describe, expect, test } from "bun:test"

import type { ManifestPage } from "~shared/api"

import { resetRateLimits } from "../src/tracks/rateLimit"
import { computeContentHash } from "../src/tracks/contentHash"
import { authHeaders, makeTrack, putTrack, setup, signIn } from "./helpers"

import type { TrackCoords } from "~shared/tracks"

/** Distinct geometry per track, so each gets its own content hash. */
const coords = (n: number): TrackCoords => [
  [13.4 + n, 52.5],
  [13.401 + n, 52.501],
]

beforeEach(() => {
  resetRateLimits()
})

async function manifest(
  app: ReturnType<typeof setup>["app"],
  token: string
): Promise<ManifestPage> {
  const res = await app.request("/api/tracks/manifest?since=0", {
    headers: authHeaders(token),
  })
  return (await res.json()) as ManifestPage
}

describe("DELETE /api/tracks — server-only purge", () => {
  test("removes every track and reports the count", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "allowed-user" })

    await putTrack(
      app,
      token,
      makeTrack({ name: "a.gpx", coordinates: coords(1) })
    )
    await putTrack(
      app,
      token,
      makeTrack({ name: "b.gpx", coordinates: coords(2) })
    )
    expect((await manifest(app, token)).tracks).toHaveLength(2)

    const purge = await app.request("/api/tracks", {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(purge.status).toBe(200)
    expect(await purge.json()).toEqual({ deleted: 2 })
    expect((await manifest(app, token)).tracks).toHaveLength(0)
  })

  /**
   * The property that makes this "server only". A tombstone would tell every
   * other device to delete its local copy, which is the opposite of the intent.
   */
  test("writes no tombstones, so other devices keep their tracks", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "allowed-user" })
    await putTrack(
      app,
      token,
      makeTrack({ name: "a.gpx", coordinates: coords(1) })
    )

    await app.request("/api/tracks", {
      method: "DELETE",
      headers: authHeaders(token),
    })

    const page = await manifest(app, token)
    expect(page.deletions).toHaveLength(0)
  })

  test("a single-track delete still writes a tombstone", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "allowed-user" })
    const track = makeTrack({ name: "a.gpx", coordinates: coords(1) })
    await putTrack(app, token, track)

    await app.request(`/api/tracks/${await computeContentHash(track)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })

    expect((await manifest(app, token)).deletions).toHaveLength(1)
  })

  test("purges only the caller's tracks", async () => {
    const { store, app } = setup()
    const a = await signIn(store, { login: "allowed-user" })
    const b = await signIn(store, { login: "other-user", status: "allowed" })

    await putTrack(
      app,
      a.token,
      makeTrack({ name: "a.gpx", coordinates: coords(1) })
    )
    await putTrack(
      app,
      b.token,
      makeTrack({ name: "b.gpx", coordinates: coords(2) })
    )

    const purge = await app.request("/api/tracks", {
      method: "DELETE",
      headers: authHeaders(a.token),
    })
    expect(await purge.json()).toEqual({ deleted: 1 })
    expect((await manifest(app, b.token)).tracks).toHaveLength(1)
  })

  test("is refused for a user who is not allowlisted", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "stranger",
      status: "pending",
    })
    const purge = await app.request("/api/tracks", {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(purge.status).toBe(403)
  })

  test("is idempotent on an empty library", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "allowed-user" })
    const purge = await app.request("/api/tracks", {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(await purge.json()).toEqual({ deleted: 0 })
  })
})
