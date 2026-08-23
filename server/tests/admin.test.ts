import { describe, expect, test } from "bun:test"

import { authHeaders, setup, signIn } from "./helpers"

describe("admin access workflow", () => {
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
})
