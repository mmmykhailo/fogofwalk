import { beforeEach, describe, expect, test } from "bun:test"

import type {
  ApiError,
  ManifestPage,
  ActivityDeleteResponse,
  ActivityMeta,
} from "~shared/api"
import {
  UPLOAD_RATE_MAX_PER_WINDOW,
  UPLOAD_RATE_WINDOW_MS,
} from "~shared/constants"

import { resetRateLimits } from "../src/activities/rateLimit"
import { computeContentHash } from "../src/activities/contentHash"
import {
  authHeaders,
  fakeHash,
  makeActivity,
  putActivity,
  setup,
  signIn,
} from "./helpers"

beforeEach(() => {
  resetRateLimits()
})

describe("access gating", () => {
  test("a pending user is refused by every activity route", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "stranger",
      status: "pending",
    })

    const manifest = await app.request("/api/activities/manifest", {
      headers: authHeaders(token),
    })
    expect(manifest.status).toBe(403)
    expect(await manifest.json()).toMatchObject({ error: "not_allowed" })

    const upload = await putActivity(app, token, makeActivity())
    expect(upload.status).toBe(403)
  })

  test("a blocked user is refused as well", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "banned",
      status: "blocked",
    })
    const response = await app.request("/api/activities/manifest", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(403)
  })

  test("a missing or bogus token is 401, not 403", async () => {
    const { app } = setup()

    expect((await app.request("/api/activities/manifest")).status).toBe(401)
    expect(
      (
        await app.request("/api/activities/manifest", {
          headers: authHeaders("not-a-real-token"),
        })
      ).status
    ).toBe(401)
  })

  test("an allowed user reaches the manifest", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const response = await app.request("/api/activities/manifest", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    const page = (await response.json()) as ManifestPage
    expect(page.activities).toEqual([])
    expect(page.deletions).toEqual([])
    expect(page.hasMore).toBe(false)
  })
})

describe("upload", () => {
  test("stores the activity and reports its metadata", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity()

    const response = await putActivity(app, token, activity)
    expect(response.status).toBe(200)

    const meta = (await response.json()) as ActivityMeta
    expect(meta.contentHash).toBe(await computeContentHash(activity))
    expect(meta.name).toBe("Morning run")
    expect(meta.format).toBe("gpx")
    expect(meta.pointCount).toBe(3)
    expect(meta.sizeBytes).toBeGreaterThan(0)
  })

  test("rejects a declared hash that does not match the geometry", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const response = await putActivity(
      app,
      token,
      makeActivity(),
      fakeHash(0xbadbeef)
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "bad_request" })

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.activities).toEqual([])
  })

  test("rejects a hash that is not 64 hex digits", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const notHex = await putActivity(app, token, makeActivity(), "z".repeat(64))
    expect(notHex.status).toBe(400)

    // A traversal attempt never reaches a handler at all, let alone the
    // filesystem — but it must certainly not succeed.
    const traversal = await putActivity(
      app,
      token,
      makeActivity(),
      encodeURIComponent("../../etc/passwd")
    )
    expect(traversal.status).toBe(400)
  })

  test("rejects a malformed payload", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const broken = { ...makeActivity(), coordinates: [] }
    const hash = await computeContentHash(makeActivity())
    const response = await app.request(`/api/activities/${hash}`, {
      method: "PUT",
      headers: { ...authHeaders(token), "Content-Encoding": "gzip" },
      body: Bun.gzipSync(new TextEncoder().encode(JSON.stringify(broken))),
    })
    expect(response.status).toBe(400)
  })

  test("is idempotent — the same PUT twice leaves one row", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity()

    const first = await putActivity(app, token, activity)
    const second = await putActivity(app, token, activity)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstMeta = (await first.json()) as ActivityMeta
    const secondMeta = (await second.json()) as ActivityMeta
    // Identical geometry keeps the original updatedAt so retries do not churn
    // every other device's manifest.
    expect(secondMeta.updatedAt).toBe(firstMeta.updatedAt)

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.activities).toHaveLength(1)
  })

  test("updates activity type without changing geometry identity", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity({ activityType: "running" })
    const hash = await computeContentHash(activity)

    const first = await putActivity(app, token, activity)
    const changed = await putActivity(app, token, {
      ...activity,
      activityType: "cycling",
    })

    expect(first.status).toBe(200)
    expect(changed.status).toBe(200)
    expect(((await changed.json()) as ActivityMeta).activityType).toBe(
      "cycling"
    )

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.activities).toHaveLength(1)
    expect(manifest.activities[0]?.contentHash).toBe(hash)
    expect(manifest.activities[0]?.activityType).toBe("cycling")

    const response = await app.request(`/api/activities/${hash}`, {
      headers: authHeaders(token),
    })
    const payload = JSON.parse(
      new TextDecoder().decode(
        Bun.gunzipSync(new Uint8Array(await response.arrayBuffer()))
      )
    )
    expect(payload.activityType).toBe("cycling")
  })

  test("round-trips the gzipped blob", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity()
    const hash = await computeContentHash(activity)

    await putActivity(app, token, activity)

    const response = await app.request(`/api/activities/${hash}`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Encoding")).toBe("gzip")

    const bytes = new Uint8Array(await response.arrayBuffer())
    const json = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes)))
    expect(json.name).toBe(activity.name)
    expect(json.coordinates).toEqual(activity.coordinates)
  })

  test("past the rate limit, the 429 says how long to wait", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    // Distinct geometry per upload so nothing is deduped away before the
    // limiter is reached.
    for (let i = 0; i < UPLOAD_RATE_MAX_PER_WINDOW; i++) {
      const response = await putActivity(
        app,
        token,
        makeActivity({ coordinates: [[13.4 + i / 10_000, 52.5]] })
      )
      expect(response.status).toBe(200)
    }

    const response = await putActivity(app, token, makeActivity())
    expect(response.status).toBe(429)

    // The client pauses every in-flight upload for `retryAfterMs`, so it has to
    // be present and inside the window — an absent one falls back to a guess.
    const body = (await response.json()) as ApiError
    expect(body.error).toBe("rate_limited")
    expect(body.retryAfterMs).toBeGreaterThan(0)
    expect(body.retryAfterMs).toBeLessThanOrEqual(UPLOAD_RATE_WINDOW_MS)

    // The standard header too, for anything that is not this client.
    const retryAfter = Number(response.headers.get("Retry-After"))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
  })
})

describe("cross-user isolation", () => {
  test("user B cannot read user A's activity", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const activity = makeActivity()
    const hash = await computeContentHash(activity)
    expect((await putActivity(app, a.token, activity)).status).toBe(200)

    const asA = await app.request(`/api/activities/${hash}`, {
      headers: authHeaders(a.token),
    })
    expect(asA.status).toBe(200)

    const asB = await app.request(`/api/activities/${hash}`, {
      headers: authHeaders(b.token),
    })
    expect(asB.status).toBe(404)

    const manifestB = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(b.token),
      })
    ).json()) as ManifestPage
    expect(manifestB.activities).toEqual([])
  })

  test("user B's delete does not touch user A's activity", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const activity = makeActivity()
    const hash = await computeContentHash(activity)
    await putActivity(app, a.token, activity)

    const deleted = await app.request(`/api/activities/${hash}`, {
      method: "DELETE",
      headers: authHeaders(b.token),
    })
    expect(deleted.status).toBe(200)

    const stillThere = await app.request(`/api/activities/${hash}`, {
      headers: authHeaders(a.token),
    })
    expect(stillThere.status).toBe(200)
  })
})

describe("delete", () => {
  test("writes a tombstone that shows up in the manifest", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity()
    const hash = await computeContentHash(activity)

    await putActivity(app, token, activity)

    const response = await app.request(`/api/activities/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)
    // The timestamp lets the deleting device mark its own tombstone applied.
    const deleteBody = (await response.json()) as ActivityDeleteResponse
    expect(deleteBody.deletedAt).toBeGreaterThan(0)

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.activities).toEqual([])
    expect(manifest.deletions).toHaveLength(1)
    expect(manifest.deletions[0]!.contentHash).toBe(hash)

    expect(
      (
        await app.request(`/api/activities/${hash}`, {
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
      const response = await app.request(`/api/activities/${hash}`, {
        method: "DELETE",
        headers: authHeaders(token),
      })
      expect(response.status).toBe(200)
    }

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.deletions).toHaveLength(1)
  })

  test("re-uploading after a delete clears the tombstone", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const activity = makeActivity()
    const hash = await computeContentHash(activity)

    await putActivity(app, token, activity)
    await app.request(`/api/activities/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    await putActivity(app, token, activity)

    const manifest = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as ManifestPage
    expect(manifest.activities).toHaveLength(1)
    expect(manifest.deletions).toEqual([])
  })
})
