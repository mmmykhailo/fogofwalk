/**
 *   GET    /api/me              user + capabilities (any signed-in user, allowed or not)
 *   GET    /api/account/export  full data export in JSON format (any signed-in user)
 *   DELETE /api/account         erase user, identities, sessions, tracks, blobs
 *
 * `/api/me` and `/api/account/export` are deliberately **not** behind `requireAllowed`:
 * a pending user still sees their name in the drawer, and should be able to
 * export their data.
 */

import { Hono } from "hono"

import type { DataExportResponse, MeResponse } from "~shared/api"

import { createRequireSession } from "../auth/middleware"
import type { AuthEnv } from "../auth/middleware"
import type { ServerStore } from "../store/types"
import { capabilitiesFor, toServerUser } from "../users"
import { rateLimited } from "../errors"
import {
  acquireExportSlot,
  exportOverloadRetryAfterMs,
} from "./exportConcurrency"
import { checkExportRateLimit } from "./exportRateLimit"

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

  app.get("/account/export", requireSession, async (c) => {
    const user = c.get("user")
    const userId = user.id
    const releaseExportSlot = acquireExportSlot()
    if (!releaseExportSlot) {
      return rateLimited(
        c,
        "Too many exports are in progress. Try again later.",
        exportOverloadRetryAfterMs
      )
    }

    const rateLimit = checkExportRateLimit(userId)
    if (!rateLimit.ok) {
      releaseExportSlot()
      return rateLimited(
        c,
        "Export limit reached. Try again later.",
        rateLimit.retryAfterMs
      )
    }

    try {
      // Collect all user data
      const [identities, sessions, tracks] = await Promise.all([
        store.findIdentitiesForUser(userId),
        store.findSessionsForUser(userId),
        store.listAllTracksForUser(userId),
      ])

      const serverUser = await toServerUser(store, user)

      const response: DataExportResponse = {
        exportedAt: new Date().toISOString(),
        account: {
          ...serverUser,
          createdAt: user.createdAt,
        },
        identities: identities.map((identity) => ({
          provider: identity.provider,
          providerUserId: identity.providerUserId,
          login: identity.providerLogin,
          email: identity.email,
          createdAt: identity.createdAt,
        })),
        sessions: sessions.map((session) => ({
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          lastUsedAt: session.lastUsedAt,
        })),
        tracks,
      }

      // Set response headers for download
      c.header("Content-Type", "application/json")
      c.header(
        "Content-Disposition",
        `attachment; filename="fogofwalk-export-${Date.now()}.json"`
      )

      return c.json(response)
    } finally {
      releaseExportSlot()
    }
  })

  app.delete("/account", requireSession, async (c) => {
    // Server-side only: the device keeps its local IndexedDB copy of every
    // track, which is what the confirmation copy in the UI promises.
    await store.deleteUser(c.get("user").id)
    return c.body(null, 204)
  })

  return app
}
