import { describe, expect, test } from "bun:test"

import type { AuthExchangeResponse, AuthProvidersResponse } from "~shared/api"

import { resolveRedirectOrigin } from "../src/auth/routes"
import {
  consumeHandoffCode,
  createHandoffCode,
  createSessionFor,
  hashToken,
  verifySessionToken,
} from "../src/auth/session"
import { MemoryStore } from "../src/store/memory"
import { authHeaders, setup, signIn } from "./helpers"

describe("GET /api/auth/providers", () => {
  test("lists nothing when no provider credentials are configured", async () => {
    const { app } = setup()
    const response = await app.request("/api/auth/providers")
    expect(response.status).toBe(200)

    const body = (await response.json()) as AuthProvidersResponse
    expect(body.providers).toEqual([])
  })

  test("an unconfigured provider cannot be started", async () => {
    const { app } = setup()
    const response = await app.request(
      "/api/auth/github/start?redirect=http://localhost:5173"
    )
    expect(response.status).toBe(404)
  })
})

describe("open-redirect guard", () => {
  test("accepts an allowed origin", () => {
    expect(resolveRedirectOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173"
    )
    expect(resolveRedirectOrigin("http://localhost:5173/some/path")).toBe(
      "http://localhost:5173"
    )
  })

  test("rejects anything else", () => {
    expect(resolveRedirectOrigin("https://evil.example")).toBeNull()
    // A prefix match would let `localhost:5173.evil.example` through.
    expect(
      resolveRedirectOrigin("http://localhost:5173.evil.example")
    ).toBeNull()
    expect(resolveRedirectOrigin("not a url")).toBeNull()
  })

  test("falls back to the first allowed origin when none is given", () => {
    expect(resolveRedirectOrigin(undefined)).toBe("http://localhost:5173")
  })
})

describe("sessions", () => {
  test("the token is stored only as its hash", async () => {
    const store = new MemoryStore()
    const user = await store.upsertUserFromIdentity({
      provider: "github",
      providerUserId: "1",
      login: "someone",
      displayName: "Someone",
      avatarUrl: null,
      email: null,
    })

    const { token } = await createSessionFor(store, user.id)
    expect(await store.findSession(token)).toBeNull()
    expect(await store.findSession(await hashToken(token))).not.toBeNull()

    const verified = await verifySessionToken(store, token)
    expect(verified?.user.id).toBe(user.id)
  })

  test("an expired session is rejected and swept", async () => {
    const store = new MemoryStore()
    const user = await store.upsertUserFromIdentity({
      provider: "github",
      providerUserId: "2",
      login: "someone",
      displayName: "Someone",
      avatarUrl: null,
      email: null,
    })

    const token = "expired-token"
    await store.createSession(user.id, await hashToken(token), Date.now() - 1)

    expect(await verifySessionToken(store, token)).toBeNull()
    expect(await store.findSession(await hashToken(token))).toBeNull()
  })

  test("logout revokes exactly that token", async () => {
    const { store, app } = setup()
    const { token } = await signIn(store)

    expect(
      (await app.request("/api/me", { headers: authHeaders(token) })).status
    ).toBe(200)

    const response = await app.request("/api/auth/logout", {
      method: "POST",
      headers: authHeaders(token),
    })
    expect(response.status).toBe(204)

    expect(
      (await app.request("/api/me", { headers: authHeaders(token) })).status
    ).toBe(401)
  })
})

describe("handoff codes", () => {
  test("are single use", () => {
    const code = createHandoffCode("user-1", "token-1", Date.now() + 1000)
    expect(consumeHandoffCode(code)?.token).toBe("token-1")
    expect(consumeHandoffCode(code)).toBeNull()
  })

  test("exchange rejects an unknown code", async () => {
    const { app } = setup()
    const response = await app.request("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "nope" }),
    })
    expect(response.status).toBe(401)
  })

  test("exchange trades a code for the session token and capabilities", async () => {
    const { store, app } = setup()
    const { user, token } = await signIn(store)
    const code = createHandoffCode(user.id, token, Date.now() + 60_000)

    const response = await app.request("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as AuthExchangeResponse
    expect(body.token).toBe(token)
    expect(body.user.id).toBe(user.id)
    expect(body.capabilities.sync).toBe(true)

    // And the token actually works.
    expect(
      (await app.request("/api/me", { headers: authHeaders(body.token) }))
        .status
    ).toBe(200)
  })

  test("exchange rejects a malformed body", async () => {
    const { app } = setup()
    const response = await app.request("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })
})

describe("health", () => {
  test("responds", async () => {
    const { app } = setup()
    const response = await app.request("/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
