import { describe, expect, test } from "bun:test"

import { authHeaders, makeTrack, putTrack, setup, signIn } from "./helpers"
import { encryptTelegramToken } from "../src/telegram"

describe("admin access workflow", () => {
  test("sends one notification when concurrent requests create one row", async () => {
    const { app, store } = setup()
    const applicant = await signIn(store, {
      login: "applicant",
      status: "pending",
    })
    await store.setSetting("telegram_chat_id", "123", "admin")
    await store.setSetting(
      "telegram_bot_token",
      await encryptTelegramToken("test-token"),
      "admin"
    )
    const originalFetch = globalThis.fetch
    let notifications = 0
    globalThis.fetch = (async () => {
      notifications += 1
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    try {
      const [first, second] = await Promise.all([
        app.request("/api/access-request", {
          method: "POST",
          headers: authHeaders(applicant.token),
        }),
        app.request("/api/access-request", {
          method: "POST",
          headers: authHeaders(applicant.token),
        }),
      ])
      expect([first.status, second.status].sort()).toEqual([200, 201])
      expect(notifications).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("masks the admin API and lets an administrator approve a request", async () => {
    const { app, store } = setup()
    const anonymous = await app.request("/api/admin/bootstrap")
    expect(anonymous.status).toBe(404)
    expect(await anonymous.json()).toEqual({ error: "not_found" })

    const applicant = await signIn(store, {
      login: "applicant",
      status: "pending",
    })
    const hidden = await app.request("/api/admin/bootstrap", {
      headers: authHeaders(applicant.token),
    })
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual({ error: "not_found" })

    const created = await app.request("/api/access-request", {
      method: "POST",
      headers: authHeaders(applicant.token),
    })
    expect(created.status).toBe(201)
    const again = await app.request("/api/access-request", {
      method: "POST",
      headers: authHeaders(applicant.token),
    })
    expect(again.status).toBe(200)

    const admin = await signIn(store, {
      login: "admin-user",
      status: "allowed",
    })
    const bootstrap = await app.request("/api/admin/bootstrap", {
      headers: authHeaders(admin.token),
    })
    const data = (await bootstrap.json()) as { requests: Array<{ id: string }> }
    expect(bootstrap.status).toBe(200)
    expect(data.requests).toHaveLength(1)
    const approved = await app.request(
      `/api/admin/requests/${data.requests[0]!.id}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(admin.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ decision: "approve" }),
      }
    )
    expect(approved.status).toBe(200)
    expect((await store.getUser(applicant.user.id))?.status).toBe("allowed")

    const blocked = await app.request(
      `/api/admin/users/${applicant.user.id}/status`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(admin.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "blocked" }),
      }
    )
    expect(blocked.status).toBe(200)
    expect((await store.getUser(applicant.user.id))?.status).toBe("blocked")
    expect((await store.getAccessRequest(applicant.user.id))?.status).toBe(
      "rejected"
    )
  })

  test("reports each user's current track storage in the admin bootstrap", async () => {
    const { app, store } = setup()
    const admin = await signIn(store, {
      login: "admin-user",
      status: "allowed",
    })
    const user = await signIn(store, { login: "walker", status: "allowed" })
    const first = makeTrack({ name: "First" })
    const second = makeTrack({
      name: "Second",
      isPublic: true,
      startedAtMs: 1_700_100_000_000,
    })
    const firstUpload = await putTrack(app, user.token, first)
    const secondUpload = await putTrack(app, user.token, second)
    const firstMeta = (await firstUpload.json()) as { sizeBytes: number }
    const secondMeta = (await secondUpload.json()) as { sizeBytes: number }

    const response = await app.request("/api/admin/bootstrap", {
      headers: authHeaders(admin.token),
    })
    const data = (await response.json()) as {
      users: Array<{ handle: string | null; storage: unknown }>
    }
    const walker = data.users.find((item) => item.handle === "walker")

    expect(response.status).toBe(200)
    expect(walker?.storage).toEqual({
      trackCount: 2,
      publicTrackCount: 1,
      trackSizeBytes: firstMeta.sizeBytes + secondMeta.sizeBytes,
    })
  })
})
