import { describe, expect, test } from "bun:test"

import type {
  ApiError,
  DataExportResponse,
  ManifestPage,
  MeResponse,
} from "~shared/api"

import { computeContentHash } from "../src/activities/contentHash"
import {
  authHeaders,
  makeActivity,
  putActivity,
  setup,
  signIn,
} from "./helpers"

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
    expect(body.user.handle).toBe("allowed-user")
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

describe("GET /api/account/export", () => {
  test("returns all user data including account, identities, sessions, and activities", async () => {
    const { store, app } = setup()
    const { token, user } = await signIn(store)

    // Add an activity
    const activity = makeActivity()
    await putActivity(app, token, activity)

    const response = await app.request("/api/account/export", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as DataExportResponse
    expect(body.exportedAt).toBeDefined()
    expect(typeof body.exportedAt).toBe("string")

    // Check account data
    expect(body.account.id).toBe(user.id)
    expect(body.account.displayName).toBe("allowed-user")
    expect(body.account.provider).toBe("github")
    expect(body.account.status).toBe("allowed")
    expect(body.account.createdAt).toBeDefined()

    // Check identities
    expect(body.identities).toHaveLength(1)
    const [identity] = body.identities
    if (!identity) throw new Error("export omitted the user's identity")
    expect(identity.provider).toBe("github")
    expect(identity.login).toBe("allowed-user")
    expect(identity.providerUserId).toBe("allowed-user")

    // Check sessions
    expect(body.sessions.length).toBeGreaterThan(0)
    const [session] = body.sessions
    if (!session) throw new Error("export omitted the user's session")
    expect(session.createdAt).toBeDefined()
    expect(session.expiresAt).toBeDefined()
    expect(session.lastUsedAt).toBeDefined()

    // Check activities
    expect(body.activities).toHaveLength(1)
    const [exportedActivity] = body.activities
    if (!exportedActivity) throw new Error("export omitted the user's activity")
    expect(exportedActivity.name).toBe("Morning run")
    expect(exportedActivity.format).toBe("gpx")
    expect(exportedActivity.coordinates).toHaveLength(3)
    expect(exportedActivity.stats.distanceKm).toBe(4.2)
  })

  test("includes multiple activities when uploaded", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    await putActivity(app, token, makeActivity({ name: "Run 1" }))
    await putActivity(
      app,
      token,
      makeActivity({ name: "Run 2", startedAtMs: 1_700_000_001_000 })
    )
    await putActivity(
      app,
      token,
      makeActivity({ name: "Run 3", startedAtMs: 1_700_000_002_000 })
    )

    const response = await app.request("/api/account/export", {
      headers: authHeaders(token),
    })
    const body = (await response.json()) as DataExportResponse
    expect(body.activities).toHaveLength(3)
    expect(body.activities.map((t) => t.name)).toEqual([
      "Run 1",
      "Run 2",
      "Run 3",
    ])
  })

  test("works for a pending user without sync", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, {
      login: "pending-user",
      status: "pending",
    })

    const response = await app.request("/api/account/export", {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as DataExportResponse
    expect(body.account.status).toBe("pending")
  })

  test("includes the identity associated with the signed-in user", async () => {
    const { store, app } = setup()
    const user = await store.upsertUserFromIdentity({
      provider: "github",
      providerUserId: "github-123",
      login: "ghuser",
      displayName: "GitHub User",
      avatarUrl: null,
      email: "user@github.com",
    })
    await store.setUserStatus(user.id, "allowed")
    const session = await (
      await import("../src/auth/session")
    ).createSessionFor(store, user.id)

    const response = await app.request("/api/account/export", {
      headers: authHeaders(session.token),
    })
    const body = (await response.json()) as DataExportResponse

    expect(body.identities).toHaveLength(1)
    expect(body.identities[0]?.providerUserId).toBe("github-123")
    expect(body.identities[0]?.login).toBe("ghuser")
  })

  test("is 401 without a token", async () => {
    const { app } = setup()
    expect((await app.request("/api/account/export")).status).toBe(401)
  })

  test("limits repeated exports for one user", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const request = () =>
      app.request("/api/account/export", {
        headers: authHeaders(token),
      })

    expect((await request()).status).toBe(200)

    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBeTruthy()
    const body = (await limited.json()) as ApiError
    expect(body.retryAfterMs).toBeGreaterThan(0)
  })

  test("isolated from other users' data", async () => {
    const { store, app } = setup()
    const user1 = await signIn(store, { login: "user1", providerUserId: "1" })
    const user2 = await signIn(store, { login: "user2", providerUserId: "2" })

    // User1 adds an activity
    await putActivity(app, user1.token, makeActivity({ name: "User1 Run" }))

    // User2 adds a different activity
    await putActivity(app, user2.token, makeActivity({ name: "User2 Run" }))

    // Each user only sees their own data
    const export1 = (await (
      await app.request("/api/account/export", {
        headers: authHeaders(user1.token),
      })
    ).json()) as DataExportResponse

    const export2 = (await (
      await app.request("/api/account/export", {
        headers: authHeaders(user2.token),
      })
    ).json()) as DataExportResponse

    expect(export1.account.displayName).toBe("user1")
    expect(export1.activities).toHaveLength(1)
    expect(export1.activities[0]?.name).toBe("User1 Run")

    expect(export2.account.displayName).toBe("user2")
    expect(export2.activities).toHaveLength(1)
    expect(export2.activities[0]?.name).toBe("User2 Run")
  })

  test("returns proper content headers for download", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    const response = await app.request("/api/account/export", {
      headers: authHeaders(token),
    })

    expect(response.headers.get("Content-Type")).toBe("application/json")
    const disposition = response.headers.get("Content-Disposition")
    expect(disposition).toBeDefined()
    expect(disposition).toContain("attachment")
    expect(disposition).toContain("fogofwalk-export-")
    expect(disposition).toContain(".json")
  })
})

describe("DELETE /api/account", () => {
  test("erases the user, their session and all of their activities", async () => {
    const { store, app } = setup()
    const { token, user } = await signIn(store)
    const other = await signIn(store, {
      login: "other-user",
      providerUserId: "b",
    })

    const activity = makeActivity()
    const hash = await computeContentHash(activity)
    await putActivity(app, token, activity)
    await putActivity(app, other.token, makeActivity({ name: "Theirs" }))
    await app.request(`/api/activities/${hash}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    await putActivity(app, token, makeActivity({ name: "Second" }))

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
    expect(manifest.activities).toEqual([])
    expect(manifest.deletions).toEqual([])

    // The token is dead.
    expect(
      (await app.request("/api/me", { headers: authHeaders(token) })).status
    ).toBe(401)

    // The other user is untouched.
    const theirs = (await (
      await app.request("/api/activities/manifest", {
        headers: authHeaders(other.token),
      })
    ).json()) as ManifestPage
    expect(theirs.activities).toHaveLength(1)
  })

  test("is 401 without a token", async () => {
    const { app } = setup()
    expect(
      (await app.request("/api/account", { method: "DELETE" })).status
    ).toBe(401)
  })
})
