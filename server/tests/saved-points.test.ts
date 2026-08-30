import { describe, expect, test } from "bun:test"

import type {
  PublicProfileResponse,
  SavedPointManifestPage,
  SavedPointUpsertResponse,
} from "~shared/api"
import { SYNC_PAGE_SIZE } from "~shared/constants"
import type { SavedPoint } from "~shared/saved-points"

import { authHeaders, setup, signIn } from "./helpers"

const pointId = "9b57f112-e3c7-44e7-a79a-8b4ec1a028af"
const otherPointId = "b0f8d223-f4d8-45f8-b8aa-9c5fd2b139b0"

function savedPoint(overrides: Record<string, unknown> = {}) {
  return {
    id: pointId,
    lng: 14.4378,
    lat: 50.0755,
    name: "Charles Bridge",
    description: null,
    color: "blue",
    isPublic: false,
    ...overrides,
  }
}

async function putSavedPoint(
  app: ReturnType<typeof setup>["app"],
  token: string,
  body: Record<string, unknown>
) {
  return app.request(`/api/saved-points/${body.id}`, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("saved-point routes", () => {
  test("requires a signed-in, allowed user", async () => {
    const { store, app } = setup()
    expect((await app.request("/api/saved-points/manifest")).status).toBe(401)

    const { token } = await signIn(store, { status: "pending" })
    expect(
      (
        await app.request("/api/saved-points/manifest", {
          headers: authHeaders(token),
        })
      ).status
    ).toBe(403)
  })

  test("validates UUIDs, text, palette keys, and WGS84 coordinates", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const invalidBodies = [
      savedPoint({ id: "not-a-uuid" }),
      savedPoint({ lng: 180.000001 }),
      savedPoint({ lat: Number.NaN }),
      savedPoint({ name: "   " }),
      savedPoint({ name: "x".repeat(121) }),
      savedPoint({ description: "x".repeat(2_001) }),
      savedPoint({ color: "#2563eb" }),
    ]

    for (const body of invalidBodies) {
      const response = await putSavedPoint(app, token, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: "bad_request" })
    }

    const emojiName = savedPoint({ name: "🙂".repeat(120) })
    expect((await putSavedPoint(app, token, emojiName)).status).toBe(200)
  })

  test("upserts normalized values and exposes deletion tombstones through the manifest", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)
    const created = await putSavedPoint(
      app,
      token,
      savedPoint({
        name: "  Charles Bridge  ",
        description: "  Morning walk  ",
      })
    )
    expect(created.status).toBe(200)
    const response = (await created.json()) as SavedPointUpsertResponse
    expect(response.savedPoint).toMatchObject({
      id: pointId,
      name: "Charles Bridge",
      description: "Morning walk",
    })

    const listed = await app.request("/api/saved-points", {
      headers: authHeaders(token),
    })
    expect(await listed.json()).toHaveLength(1)

    const deleted = await app.request(`/api/saved-points/${pointId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    })
    expect(deleted.status).toBe(200)
    const { deletedAt } = (await deleted.json()) as { deletedAt: number }

    const manifest = (await (
      await app.request("/api/saved-points/manifest", {
        headers: authHeaders(token),
      })
    ).json()) as SavedPointManifestPage
    expect(manifest.savedPoints).toEqual([])
    expect(manifest.deletions).toContainEqual({ id: pointId, deletedAt })
  })

  test("pages points and tombstones without advancing past an unfinished stream", async () => {
    const { store } = setup()
    const { user } = await signIn(store)
    const base = Date.now()

    for (let index = 0; index <= SYNC_PAGE_SIZE; index++) {
      const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
      await store.upsertSavedPoint(user.id, {
        ...savedPoint({ id, name: `Point ${index}` }),
        createdAt: base,
        updatedAt: base,
      } as SavedPoint)
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
    await store.deleteSavedPoint(user.id, otherPointId)

    const ids = new Set<string>()
    let cursor = 0
    let hasMore = true
    while (hasMore) {
      const page = await store.listSavedPointsManifest(user.id, cursor)
      page.savedPoints.forEach((point) => ids.add(point.id))
      cursor = page.cursor
      hasMore = page.hasMore
    }

    expect(ids).toHaveLength(SYNC_PAGE_SIZE + 1)
  })

  test("isolates points by owner and publicly exposes only public points", async () => {
    const { store, app } = setup()
    const owner = await signIn(store, {
      login: "point-owner",
      providerUserId: "owner",
    })
    const stranger = await signIn(store, {
      login: "point-stranger",
      providerUserId: "stranger",
    })

    await putSavedPoint(
      app,
      owner.token,
      savedPoint({ isPublic: true, name: "Public viewpoint" })
    )
    await putSavedPoint(
      app,
      owner.token,
      savedPoint({ id: otherPointId, name: "Private home", isPublic: false })
    )

    const strangerList = await app.request("/api/saved-points", {
      headers: authHeaders(stranger.token),
    })
    expect(await strangerList.json()).toEqual([])
    expect(
      (
        await app.request(`/api/saved-points/${pointId}`, {
          method: "DELETE",
          headers: authHeaders(stranger.token),
        })
      ).status
    ).toBe(200)

    const profile = (await (
      await app.request("/api/public/users/point-owner")
    ).json()) as PublicProfileResponse
    expect(profile.activities).toEqual([])
    expect(profile.savedPoints).toHaveLength(1)
    expect(profile.savedPoints[0]).toMatchObject({
      id: pointId,
      name: "Public viewpoint",
      lng: 14.4378,
      lat: 50.0755,
    })

    const publicPoint = await app.request(`/api/public/saved-points/${pointId}`)
    expect(publicPoint.status).toBe(200)
    expect(await publicPoint.json()).toMatchObject({
      id: pointId,
      name: "Public viewpoint",
    })
    expect(
      (await app.request(`/api/public/saved-points/${otherPointId}`)).status
    ).toBe(404)
  })
})
