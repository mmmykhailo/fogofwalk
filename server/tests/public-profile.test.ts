import { beforeEach, describe, expect, test } from "bun:test"

import type {
  PublicProfileResponse,
  TrackVisibilityUpdateResponse,
} from "~shared/api"

import { resetRateLimits } from "../src/tracks/rateLimit"
import { computeContentHash } from "../src/tracks/contentHash"
import { authHeaders, makeTrack, putTrack, setup, signIn } from "./helpers"

beforeEach(() => {
  resetRateLimits()
})

describe("public profiles", () => {
  test("CORS preflight permits visibility updates", async () => {
    const { app } = setup()

    const response = await app.request("/api/tracks/example/visibility", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "PATCH",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PATCH"
    )
  })

  test("a user's handle is set from their GitHub login", async () => {
    const { store } = setup()
    const { user } = await signIn(store, { login: "runner-one" })
    expect(user.handle).toBe("runner-one")
  })

  test("a colliding GitHub login does not break sign-in", async () => {
    const { store } = setup()
    const first = await signIn(store, {
      login: "shared-login",
      providerUserId: "first",
    })
    expect(first.user.handle).toBe("shared-login")

    // A second, unrelated identity signing in with the same login must not
    // throw on the `handle` UNIQUE constraint — it just gets no handle.
    const second = await signIn(store, {
      login: "shared-login",
      providerUserId: "second",
    })
    expect(second.user.handle).toBeNull()
    expect(second.user.id).not.toBe(first.user.id)

    // The first user's handle is unaffected by the second collision.
    const refreshedFirst = await store.getUser(first.user.id)
    expect(refreshedFirst?.handle).toBe("shared-login")
  })

  test("public endpoint returns 404 for unknown handles", async () => {
    const { app } = setup()
    const response = await app.request("/api/public/users/does-not-exist")
    expect(response.status).toBe(404)
  })

  test("public endpoint returns only public tracks", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "public-user" })

    const privateTrack = makeTrack({ name: "private.gpx" })
    const publicTrack = makeTrack({
      name: "public.gpx",
      coordinates: [
        [13.5, 52.5],
        [13.501, 52.501],
        [13.502, 52.502],
      ],
      isPublic: true,
    })

    await putTrack(app, token, privateTrack)
    await putTrack(app, token, publicTrack)

    const response = await app.request("/api/public/users/public-user")
    expect(response.status).toBe(200)

    const body = (await response.json()) as PublicProfileResponse
    expect(body.user.handle).toBe("public-user")
    expect(body.user.displayName).toBe("public-user")
    expect(body.tracks).toHaveLength(1)
    expect(body.tracks[0]!.name).toBe("public.gpx")
    // The profile returns all server metadata (but never the geometry blob).
    expect(body.tracks[0]!.isPublic).toBe(true)
    expect(body.tracks[0]!.sizeBytes).toBeGreaterThan(0)
    expect(body.tracks[0]!.updatedAt).toBeGreaterThan(0)
    expect(body.tracks[0]!.durationMs).toBe(1_800_000)
    expect(body.tracks[0]!.movingTimeMs).toBe(1_700_000)
    expect(body.tracks[0]!.elevationGainM).toBe(12)
    expect(body.tracks[0]!.avgMovingSpeedKmh).toBe(8.9)
  })

  test("private tracks are hidden from the public endpoint", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "private-user" })

    await putTrack(app, token, makeTrack({ name: "hidden.gpx" }))

    const response = await app.request("/api/public/users/private-user")
    expect(response.status).toBe(200)

    const body = (await response.json()) as PublicProfileResponse
    expect(body.tracks).toHaveLength(0)
  })

  test("visibility update is reflected on the public endpoint", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "toggle-user" })

    const track = makeTrack({ name: "toggle.gpx" })
    const hash = await computeContentHash(track)
    await putTrack(app, token, track)

    const before = (await (
      await app.request("/api/public/users/toggle-user")
    ).json()) as PublicProfileResponse
    expect(before.tracks).toHaveLength(0)

    const update = await app.request(`/api/tracks/${hash}/visibility`, {
      method: "PATCH",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: true }),
    })
    expect(update.status).toBe(200)
    const updateBody = (await update.json()) as TrackVisibilityUpdateResponse
    expect(updateBody.isPublic).toBe(true)

    const after = (await (
      await app.request("/api/public/users/toggle-user")
    ).json()) as PublicProfileResponse
    expect(after.tracks).toHaveLength(1)
    expect(after.tracks[0]!.contentHash).toBe(hash)
  })

  test("visibility update is refused for another user's track", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const track = makeTrack()
    const hash = await computeContentHash(track)
    await putTrack(app, a.token, track)

    const response = await app.request(`/api/tracks/${hash}/visibility`, {
      method: "PATCH",
      headers: {
        ...authHeaders(b.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: true }),
    })
    expect(response.status).toBe(404)
  })
})
