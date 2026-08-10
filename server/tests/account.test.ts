import { beforeEach, describe, expect, test } from "bun:test"

import type { ManifestPage, MeResponse } from "~shared/api"

import { resetRateLimits } from "../src/tracks/rateLimit"
import { computeContentHash } from "../src/tracks/contentHash"
import { authHeaders, makeTrack, putTrack, setup, signIn } from "./helpers"

beforeEach(() => {
  resetRateLimits()
})

describe("GET /api/me", () => {
  test("reports capabilities for an allowed user", async () => {
    const { store, app } = setup()
    const { token, user } = await signIn(store)

    const response = await app.request("/api/me", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as MeResponse
    expect(body.user.id).toBe(user.id)
    expect(body.user.provider).toBe("github")
    expect(body.user.status).toBe("allowed")
    expect(body.capabilities.sync).toBe(true)
  })

  test("a pending user still sees their identity, without sync", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "stranger",
      status: "pending",
    })

    const body = (await (
      await app.request("/api/me", { headers: authHeaders(token) })
    ).json()) as MeResponse
    expect(body.user.displayName).toBe("stranger")
    expect(body.capabilities.sync).toBe(false)
  })

  test("is 401 without a token", async () => {
    const { app } = setup()
    expect((await app.request("/api/me")).status).toBe(401)
  })
})

describe("DELETE /api/account", () => {
  test("erases the user, their session and all of their tracks", async () => {
    const { store, app } = setup()
    const { token, user } = await signIn(store)
    const other = await signIn(store, {
      login: "other-user",
      providerUserId: "b",
    })

    const track = makeTrack()
    const hash = await computeContentHash(track)
    await putTrack(app, token, track)
    await putTrack(app, other.token, makeTrack({ name: "Theirs" }))
    await app.request(`/api/tracks/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    await putTrack(app, token, makeTrack({ name: "Second" }))

    const deleted = await app.request("/api/account", {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(deleted.status).toBe(204)

    // Nothing of theirs survives, in any table.
    expect(await store.getUser(user.id)).toBeNull()
    expect(await store.findUserByIdentity("github", "allowed-user")).toBeNull()
    expect(await store.findPrimaryIdentity(user.id)).toBeNull()
    const manifest = await store.listManifest(user.id, 0)
    expect(manifest.tracks).toEqual([])
    expect(manifest.deletions).toEqual([])

    // The token is dead.
    expect(
      (await app.request("/api/me", { headers: authHeaders(token) })).status
    ).toBe(401)

    // The other user is untouched.
    const theirs = (await (
      await app.request("/api/tracks/manifest", {
        headers: authHeaders(other.token),
      })
    ).json()) as ManifestPage
    expect(theirs.tracks).toHaveLength(1)
  })

  test("is 401 without a token", async () => {
    const { app } = setup()
    expect(
      (await app.request("/api/account", { method: "DELETE" })).status
    ).toBe(401)
  })
})
