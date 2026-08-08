import { beforeEach, describe, expect, test } from "bun:test"

import type { ManifestPage, TrackDeleteResponse, TrackMeta } from "~shared/api"

import { resetRateLimits } from "../src/tracks/rateLimit"
import { computeContentHash } from "../src/tracks/contentHash"
import {
  authHeaders,
  fakeHash,
  makeTrack,
  putTrack,
  setup,
  signIn,
} from "./helpers"

beforeEach(() => {
  resetRateLimits()
})

describe("allowlist gating", () => {
  test("a pending user is refused by every track route", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "stranger",
      status: "pending",
    })

    const manifest = await app.request("/api/tracks/manifest", {
      headers: authHeaders(token),
    })
    expect(manifest.status).toBe(403)
    expect(await manifest.json()).toMatchObject({ error: "not_allowed" })

    const upload = await putTrack(app, token, makeTrack())
    expect(upload.status).toBe(403)
  })

  test("a blocked user is refused as well", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "banned",
      status: "blocked",
    })
    const response = await app.request("/api/tracks/manifest", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(403)
  })

  test("a missing or bogus token is 401, not 403", async () => {
    const { app } = setup()

    expect((await app.request("/api/tracks/manifest")).status).toBe(401)
    expect(
      (
        await app.request("/api/tracks/manifest", {
          headers: authHeaders("not-a-real-token"),
        })
      ).status
    ).toBe(401)
  })

  test("an allowed user reaches the manifest", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const response = await app.request("/api/tracks/manifest", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    const page = (await response.json()) as ManifestPage
    expect(page.tracks).toEqual([])
    expect(page.deletions).toEqual([])
    expect(page.hasMore).toBe(false)
  })
})

describe("upload", () => {
  test("stores the track and reports its metadata", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const track = makeTrack()

    const response = await putTrack(app, token, track)
    expect(response.status).toBe(200)

    const meta = (await response.json()) as TrackMeta
    expect(meta.contentHash).toBe(await computeContentHash(track))
    expect(meta.name).toBe("Morning run")
    expect(meta.format).toBe("gpx")
    expect(meta.pointCount).toBe(3)
    expect(meta.sizeBytes).toBeGreaterThan(0)
  })

  test("rejects a declared hash that does not match the geometry", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const response = await putTrack(
      app,
      token,
      makeTrack(),
      fakeHash(0xbadbeef)
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "bad_request" })

    const manifest = (await (
      await app.request("/api/tracks/manifest", { headers: authHeaders(token) })
    ).json()) as ManifestPage
    expect(manifest.tracks).toEqual([])
  })

  test("rejects a hash that is not 64 hex digits", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const notHex = await putTrack(app, token, makeTrack(), "z".repeat(64))
    expect(notHex.status).toBe(400)

    // A traversal attempt never reaches a handler at all, let alone the
    // filesystem — but it must certainly not succeed.
    const traversal = await putTrack(
      app,
      token,
      makeTrack(),
      encodeURIComponent("../../etc/passwd")
    )
    expect(traversal.status).toBe(400)
  })

  test("rejects a malformed payload", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const broken = { ...makeTrack(), coordinates: [] }
    const hash = await computeContentHash(makeTrack())
    const response = await app.request(`/api/tracks/${hash}`, {
      method: "PUT",
      headers: { ...authHeaders(token), "Content-Encoding": "gzip" },
      body: Bun.gzipSync(new TextEncoder().encode(JSON.stringify(broken))),
    })
    expect(response.status).toBe(400)
  })

  test("is idempotent — the same PUT twice leaves one row", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const track = makeTrack()

    const first = await putTrack(app, token, track)
    const second = await putTrack(app, token, track)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstMeta = (await first.json()) as TrackMeta
    const secondMeta = (await second.json()) as TrackMeta
    // Identical geometry keeps the original updatedAt so retries do not churn
    // every other device's manifest.
    expect(secondMeta.updatedAt).toBe(firstMeta.updatedAt)

    const manifest = (await (
      await app.request("/api/tracks/manifest", { headers: authHeaders(token) })
    ).json()) as ManifestPage
    expect(manifest.tracks).toHaveLength(1)
  })

  test("round-trips the gzipped blob", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const track = makeTrack()
    const hash = await computeContentHash(track)

    await putTrack(app, token, track)

    const response = await app.request(`/api/tracks/${hash}`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Encoding")).toBe("gzip")

    const bytes = new Uint8Array(await response.arrayBuffer())
    const json = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes)))
    expect(json.name).toBe(track.name)
    expect(json.coordinates).toEqual(track.coordinates)
  })
})

describe("cross-user isolation", () => {
  test("user B cannot read user A's track", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const track = makeTrack()
    const hash = await computeContentHash(track)
    expect((await putTrack(app, a.token, track)).status).toBe(200)

    const asA = await app.request(`/api/tracks/${hash}`, {
      headers: authHeaders(a.token),
    })
    expect(asA.status).toBe(200)

    const asB = await app.request(`/api/tracks/${hash}`, {
      headers: authHeaders(b.token),
    })
    expect(asB.status).toBe(404)

    const manifestB = (await (
      await app.request("/api/tracks/manifest", {
        headers: authHeaders(b.token),
      })
    ).json()) as ManifestPage
    expect(manifestB.tracks).toEqual([])
  })

  test("user B's delete does not touch user A's track", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const track = makeTrack()
    const hash = await computeContentHash(track)
    await putTrack(app, a.token, track)

    const deleted = await app.request(`/api/tracks/${hash}`, {
      method: "DELETE",
      headers: authHeaders(b.token),
    })
    expect(deleted.status).toBe(200)

    const stillThere = await app.request(`/api/tracks/${hash}`, {
      headers: authHeaders(a.token),
    })
    expect(stillThere.status).toBe(200)
  })
})

describe("delete", () => {
  test("writes a tombstone that shows up in the manifest", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const track = makeTrack()
    const hash = await computeContentHash(track)

    await putTrack(app, token, track)

    const response = await app.request(`/api/tracks/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    // The timestamp lets the deleting device mark its own tombstone applied.
    const deleteBody = (await response.json()) as TrackDeleteResponse
    expect(deleteBody.deletedAt).toBeGreaterThan(0)

    const manifest = (await (
      await app.request("/api/tracks/manifest", { headers: authHeaders(token) })
    ).json()) as ManifestPage
    expect(manifest.tracks).toEqual([])
    expect(manifest.deletions).toHaveLength(1)
    expect(manifest.deletions[0]!.contentHash).toBe(hash)

    expect(
      (
        await app.request(`/api/tracks/${hash}`, {
          headers: authHeaders(token),
        })
      ).status
    ).toBe(404)
  })

  test("is idempotent and tolerates an unknown hash", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const hash = fakeHash(7)

    for (const _ of [0, 1]) {
      const response = await app.request(`/api/tracks/${hash}`, {
        method: "DELETE",
        headers: authHeaders(token),
      })
      expect(response.status).toBe(200)
    }

    const manifest = (await (
      await app.request("/api/tracks/manifest", { headers: authHeaders(token) })
    ).json()) as ManifestPage
    expect(manifest.deletions).toHaveLength(1)
  })

  test("re-uploading after a delete clears the tombstone", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const track = makeTrack()
    const hash = await computeContentHash(track)

    await putTrack(app, token, track)
    await app.request(`/api/tracks/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    await putTrack(app, token, track)

    const manifest = (await (
      await app.request("/api/tracks/manifest", { headers: authHeaders(token) })
    ).json()) as ManifestPage
    expect(manifest.tracks).toHaveLength(1)
    expect(manifest.deletions).toEqual([])
  })
})
