/**
 * OAuth routes.
 *
 *   GET  /api/auth/providers
 *   GET  /api/auth/:provider/start?redirect=<client origin>
 *   GET  /api/auth/:provider/callback?code&state
 *   POST /api/auth/exchange   { code }  → bearer token
 *   POST /api/auth/logout
 *
 * The client never sees the provider's code and the browser never sees the
 * session token in a URL: the callback hands over a single-use 60-second code
 * which `exchange` trades for the real token over POST.
 */

import { generateCodeVerifier, generateState } from "arctic"
import { Hono } from "hono"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import { z } from "zod"

import type {
  AuthExchangeResponse,
  AuthProvidersResponse,
  UserStatus,
} from "~shared/api"

import { env } from "../env"
import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"
import { capabilitiesFor, toServerUser } from "../users"
import { createRequireSession } from "./middleware"
import type { AuthEnv } from "./middleware"
import { providers, listProviders } from "./providers"
import {
  consumeHandoffCode,
  createHandoffCode,
  createSessionFor,
  revokeSessionToken,
} from "./session"

const OAUTH_COOKIE = "fow_oauth"
const OAUTH_COOKIE_TTL_S = 10 * 60

/**
 * A `Secure` cookie is dropped by some browsers over plain http, which would
 * make local development impossible. Every non-local deployment uses https, so
 * this is on everywhere it matters.
 */
const COOKIE_SECURE = env.PUBLIC_URL.startsWith("https://")

const exchangeSchema = z.object({ code: z.string().min(1).max(512) })

interface OAuthCookiePayload {
  state: string
  verifier: string
  redirect: string
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

/**
 * Open-redirect guard. Only the exact origins in `ALLOWED_ORIGINS` may be
 * redirected to — without this, `?redirect=https://evil.example` would send a
 * valid handoff code to an attacker.
 */
export function resolveRedirectOrigin(raw: string | undefined): string | null {
  if (!raw) return env.ALLOWED_ORIGINS[0] ?? null

  let origin: string
  try {
    origin = new URL(raw).origin.toLowerCase()
  } catch {
    return null
  }
  return env.ALLOWED_ORIGINS.includes(stripTrailingSlash(origin))
    ? origin
    : null
}

/**
 * Default deny: everyone lands as `pending`. `ALLOWED_LOGINS` can only
 * *promote*, and only from `pending` — the database is authoritative
 * afterwards so an admin can allow or block an account without a redeploy,
 * and a `blocked` user can never be resurrected by an env var.
 */
export async function applyAllowlist(
  store: ServerStore,
  userId: string,
  status: UserStatus,
  provider: string,
  login: string
) {
  if (status !== "pending") return null
  const key = `${provider}:${login}`.toLowerCase()
  if (!env.ALLOWED_LOGINS.includes(key)) return null
  return store.setUserStatus(userId, "allowed")
}

export function createAuthRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()
  const requireSession = createRequireSession(store)

  app.get("/providers", (c) => {
    const body: AuthProvidersResponse = { providers: listProviders() }
    return c.json(body)
  })

  app.get("/:provider/start", async (c) => {
    const provider = providers[c.req.param("provider")]
    if (!provider) return jsonError(c, "not_found", "Unknown auth provider.")

    const redirect = resolveRedirectOrigin(c.req.query("redirect"))
    if (!redirect) {
      return jsonError(
        c,
        "bad_request",
        "The redirect origin is not in ALLOWED_ORIGINS."
      )
    }

    const state = generateState()
    const verifier = generateCodeVerifier()

    // First-party cookie on the API origin — no third-party-cookie problem,
    // and it is gone the moment the callback consumes it.
    await setSignedCookie(
      c,
      OAUTH_COOKIE,
      JSON.stringify({
        state,
        verifier,
        redirect,
      } satisfies OAuthCookiePayload),
      env.SESSION_SECRET,
      {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: "Lax",
        path: "/api/auth",
        maxAge: OAUTH_COOKIE_TTL_S,
      }
    )

    return c.redirect(provider.createAuthUrl(state, verifier).toString(), 302)
  })

  app.get("/:provider/callback", async (c) => {
    const provider = providers[c.req.param("provider")]
    if (!provider) return jsonError(c, "not_found", "Unknown auth provider.")

    const raw = await getSignedCookie(c, env.SESSION_SECRET, OAUTH_COOKIE)
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth" })

    let payload: OAuthCookiePayload | null = null
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw) as OAuthCookiePayload
      } catch {
        payload = null
      }
    }

    const fallback = env.ALLOWED_ORIGINS[0] ?? null
    const failure = (reason: string) => {
      const target = payload?.redirect ?? fallback
      if (!target) return jsonError(c, "bad_request", reason)
      return c.redirect(
        `${target}/auth/callback?error=${encodeURIComponent(reason)}`,
        302
      )
    }

    if (!payload) return failure("state_missing")

    const code = c.req.query("code")
    const state = c.req.query("state")
    if (!code || !state || state !== payload.state) {
      return failure("state_mismatch")
    }

    let profile
    try {
      profile = await provider.exchange(code, payload.verifier)
    } catch {
      return failure("exchange_failed")
    }

    const user = await store.upsertUserFromIdentity({
      provider: provider.id,
      providerUserId: profile.providerUserId,
      login: profile.login,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
    })

    await applyAllowlist(
      store,
      user.id,
      user.status,
      provider.id,
      profile.login
    )

    const session = await createSessionFor(store, user.id)
    const handoff = createHandoffCode(user.id, session.token, session.expiresAt)

    return c.redirect(
      `${payload.redirect}/auth/callback?code=${encodeURIComponent(handoff)}`,
      302
    )
  })

  app.post("/exchange", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, "bad_request", "Expected a JSON body.")
    }

    const parsed = exchangeSchema.safeParse(body)
    if (!parsed.success) return jsonError(c, "bad_request", "Missing code.")

    const entry = consumeHandoffCode(parsed.data.code)
    if (!entry) {
      return jsonError(
        c,
        "unauthorized",
        "This sign-in code is no longer valid."
      )
    }

    const user = await store.getUser(entry.userId)
    if (!user) return jsonError(c, "unauthorized")

    const response: AuthExchangeResponse = {
      token: entry.token,
      expiresAt: entry.tokenExpiresAt,
      user: await toServerUser(store, user),
      capabilities: capabilitiesFor(user),
    }
    return c.json(response)
  })

  app.post("/logout", requireSession, async (c) => {
    await revokeSessionToken(store, c.get("sessionToken"))
    return c.body(null, 204)
  })

  return app
}
