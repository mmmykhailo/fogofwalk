import { createMiddleware } from "hono/factory"

import { errorBody } from "../errors"
import type { AuthEnv } from "../auth/middleware"
import { verifySessionToken } from "../auth/session"
import type { ServerStore } from "../store/types"
import { isAdmin } from "../users"

/** A deliberately indistinguishable 404 for every non-admin case. */
export function createRequireAdmin(store: ServerStore) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header("Authorization")?.trim() ?? "")
    const token = match?.[1]?.trim()
    const verified = token ? await verifySessionToken(store, token) : null
    if (!verified || !(await isAdmin(store, verified.user.id))) {
      return c.json(errorBody("not_found"), 404)
    }
    c.set("user", verified.user)
    c.set("sessionToken", token!)
    await next()
  })
}
