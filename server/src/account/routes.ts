/**
 *   GET    /api/me        user + capabilities (any signed-in user, allowed or not)
 *   DELETE /api/account   erase user, identities, sessions, tracks, blobs
 *
 * `/api/me` is deliberately **not** behind `requireAllowed`: a pending user
 * still sees their name in the drawer, they just have `capabilities.sync ===
 * false`.
 */

import { Hono } from "hono"

import type { MeResponse } from "~shared/api"

import { createRequireSession } from "../auth/middleware"
import type { AuthEnv } from "../auth/middleware"
import type { ServerStore } from "../store/types"
import { capabilitiesFor, toServerUser } from "../users"

export function createAccountRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()
  const requireSession = createRequireSession(store)

  app.get("/me", requireSession, async (c) => {
    const user = c.get("user")
    const body: MeResponse = {
      user: await toServerUser(store, user),
      capabilities: capabilitiesFor(user),
    }
    return c.json(body)
  })

  app.delete("/account", requireSession, async (c) => {
    // Server-side only: the device keeps its local IndexedDB copy of every
    // track, which is what the confirmation copy in the UI promises.
    await store.deleteUser(c.get("user").id)
    return c.body(null, 204)
  })

  return app
}
