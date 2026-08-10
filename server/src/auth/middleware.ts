/**
 * `requireSession` resolves the bearer token; `requireAllowed` enforces the
 * default-deny allowlist. They are separate because the UI is allowed to show
 * a signed-in `pending` user their name and status — only sync is gated.
 */

import { createMiddleware } from "hono/factory"

import { jsonError } from "../errors"
import type { ServerStore, User } from "../store/types"
import { verifySessionToken } from "./session"

export interface AuthVariables {
  user: User
  /** The raw bearer token, so `logout` can revoke exactly this session. */
  sessionToken: string
}

export type AuthEnv = { Variables: AuthVariables }

function readBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

export function createRequireSession(store: ServerStore) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = readBearer(c.req.header("Authorization"))
    if (!token) return jsonError(c, "unauthorized")

    const verified = await verifySessionToken(store, token)
    if (!verified) return jsonError(c, "unauthorized")

    c.set("user", verified.user)
    c.set("sessionToken", token)
    await next()
  })
}

/** Must run after `requireSession`. */
export const requireAllowed = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get("user")
  if (user.status !== "allowed") {
    return jsonError(
      c,
      "not_allowed",
      user.status === "blocked"
        ? "This account has been blocked."
        : "This account is not enabled for sync yet."
    )
  }
  await next()
})
