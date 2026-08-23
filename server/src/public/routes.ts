/**
 * Public profile pages.
 *
 *   GET /api/public/users/:handle            → profile + public tracks
 *
 * These routes are intentionally anonymous: a profile is discoverable only by
 * its handle, and only tracks the owner marked public are listed. The internal
 * user id and access status are never exposed.
 */

import { Hono } from "hono"

import type { PublicProfileResponse } from "~shared/api"

import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"

const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

function isSafeHandle(value: string): boolean {
  return typeof value === "string" && HANDLE_RE.test(value)
}

export function createPublicRoutes(store: ServerStore) {
  const app = new Hono()

  app.get("/users/:handle", async (c) => {
    const handle = c.req.param("handle")
    if (!isSafeHandle(handle)) {
      return jsonError(c, "not_found", "Unknown user.")
    }

    const user = await store.findUserByHandle(handle)
    if (!user) {
      return jsonError(c, "not_found", "Unknown user.")
    }

    const profile = await store.listPublicTracks(user.id)
    const body: PublicProfileResponse = profile
    return c.json(body)
  })

  return app
}
