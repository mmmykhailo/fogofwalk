import { beforeEach, describe, expect, test } from "bun:test"

import type {
  PublicActivitiesPage,
  PublicProfileResponse,
  ActivityVisibilityUpdateResponse,
} from "~shared/api"

import { resetRateLimits } from "../src/activities/rateLimit"
import { computeContentHash } from "../src/activities/contentHash"
import {
  authHeaders,
  makeActivity,
  putActivity,
  setup,
  signIn,
} from "./helpers"

beforeEach(() => {
  resetRateLimits()
})

describe("public profiles", () => {
  test("CORS preflight permits visibility updates", async () => {
    const { app } = setup()

    const response = await app.request("/api/activities/example/visibility", {
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

  test("public endpoint returns only public activities", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "public-user" })

    const privateActivity = makeActivity({ name: "private.gpx" })
    const publicActivity = makeActivity({
      name: "public.gpx",
      coordinates: [
        [13.5, 52.5],
        [13.501, 52.501],
        [13.502, 52.502],
      ],
      isPublic: true,
      startSunPhase: "before_sunrise",
    })

    await putActivity(app, token, privateActivity)
    await putActivity(app, token, publicActivity)

    const response = await app.request("/api/public/users/public-user")
    expect(response.status).toBe(200)

    const body = (await response.json()) as PublicProfileResponse
    expect(body.user.handle).toBe("public-user")
    expect(body.user.displayName).toBe("public-user")
    expect(body.recentActivities).toHaveLength(1)
    expect(body.recentActivities[0]!.name).toBe("public.gpx")
    expect(body.recentActivities[0]!.durationMs).toBe(1_800_000)
    expect(body.recentActivities[0]!.movingTimeMs).toBe(1_700_000)
    expect(body.recentActivities[0]!.elevationGainM).toBe(12)
    expect(body.recentActivities[0]!.avgMovingSpeedKmh).toBe(8.9)
    expect(body.recentActivities[0]!.startSunPhase).toBe("before_sunrise")
    // Contract-level minimization: never expose internal storage/sync fields.
    expect(body.recentActivities[0]).not.toHaveProperty("isPublic")
    expect(body.recentActivities[0]).not.toHaveProperty("pointCount")
    expect(body.recentActivities[0]).not.toHaveProperty("sizeBytes")
    expect(body.recentActivities[0]).not.toHaveProperty("updatedAt")
    expect(body.totals.totalActivities).toBe(1)
    expect(body.achievementPrevalence["early-bird"]).toBe(100)
    expect(body.achievementPrevalence).not.toHaveProperty("eligibleUserCount")
    expect(body.achievementPrevalence).not.toHaveProperty("earnedUserCounts")
  })

  test("private activities are hidden from the public endpoint", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "private-user" })

    await putActivity(app, token, makeActivity({ name: "hidden.gpx" }))

    const response = await app.request("/api/public/users/private-user")
    expect(response.status).toBe(200)

    const body = (await response.json()) as PublicProfileResponse
    expect(body.recentActivities).toHaveLength(0)
  })

  test("visibility update is reflected on the public endpoint", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "toggle-user" })

    const activity = makeActivity({ name: "toggle.gpx" })
    const hash = await computeContentHash(activity)
    await putActivity(app, token, activity)

    const before = (await (
      await app.request("/api/public/users/toggle-user")
    ).json()) as PublicProfileResponse
    expect(before.recentActivities).toHaveLength(0)

    const update = await app.request(`/api/activities/${hash}/visibility`, {
      method: "PATCH",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: true }),
    })
    expect(update.status).toBe(200)
    const updateBody = (await update.json()) as ActivityVisibilityUpdateResponse
    expect(updateBody.isPublic).toBe(true)

    const after = (await (
      await app.request("/api/public/users/toggle-user")
    ).json()) as PublicProfileResponse
    expect(after.recentActivities).toHaveLength(1)
    expect(after.recentActivities[0]!.contentHash).toBe(hash)
  })

  test("public activities are bounded, newest first, and exclude private rows", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store, { login: "paged-user" })

    for (let index = 0; index < 50; index += 1) {
      await putActivity(
        app,
        token,
        makeActivity({
          name: `activity-${index}.gpx`,
          startedAtMs: 1_700_000_000_000 + index,
          isPublic: true,
        })
      )
    }
    await putActivity(
      app,
      token,
      makeActivity({
        name: "private.gpx",
        startedAtMs: 1_700_000_000_100,
      })
    )

    const first = (await (
      await app.request("/api/public/users/paged-user/activities?page=1")
    ).json()) as PublicActivitiesPage
    expect(first.totalCount).toBe(50)
    expect(first.activities).toHaveLength(48)
    expect(first.activities[0]!.name).toBe("activity-49.gpx")
    expect(first.activities.at(-1)!.name).toBe("activity-2.gpx")

    const second = (await (
      await app.request("/api/public/users/paged-user/activities?page=2")
    ).json()) as PublicActivitiesPage
    expect(second.activities.map((activity) => activity.name)).toEqual([
      "activity-1.gpx",
      "activity-0.gpx",
    ])

    const oversized = (await (
      await app.request("/api/public/users/paged-user/activities?page=999")
    ).json()) as PublicActivitiesPage
    expect(oversized.activities).toEqual([])
    expect(oversized.totalCount).toBe(50)
  })

  test("visibility update is refused for another user's activity", async () => {
    const { store, app } = setup()
    const a = await signIn(store, {
      login: "allowed-user",
      providerUserId: "a",
    })
    const b = await signIn(store, { login: "other-user", providerUserId: "b" })

    const activity = makeActivity()
    const hash = await computeContentHash(activity)
    await putActivity(app, a.token, activity)

    const response = await app.request(`/api/activities/${hash}/visibility`, {
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
