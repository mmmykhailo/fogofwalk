/**
 * Public profile pages.
 *
 *   GET /api/public/users/:handle            → bounded profile overview
 *   GET /api/public/users/:handle/activities → one page of public activities
 *
 * These routes are intentionally anonymous: a profile is discoverable only by
 * its handle, and only activities the owner marked public are listed. The internal
 * user id and access status are never exposed.
 */

import { Hono } from "hono"

import type { PublicActivitiesPage, PublicProfileResponse } from "~shared/api"
import { PUBLIC_ACTIVITY_PAGE_SIZE } from "~shared/constants"

import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"

const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

function isSafeHandle(value: string): boolean {
  return typeof value === "string" && HANDLE_RE.test(value)
}

function parsePage(value: string | undefined): number {
  if (value == null || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function createPublicRoutes(store: ServerStore) {
  const app = new Hono()

  app.get("/saved-points/:id", async (c) => {
    const point = await store.findPublicSavedPoint(c.req.param("id"))
    if (!point) return jsonError(c, "not_found", "Saved point not found.")
    return c.json(point)
  })

  app.get("/users/:handle", async (c) => {
    const handle = c.req.param("handle")
    if (!isSafeHandle(handle)) {
      return jsonError(c, "not_found", "Unknown user.")
    }

    const user = await store.findUserByHandle(handle)
    if (!user) {
      return jsonError(c, "not_found", "Unknown user.")
    }

    const profile = await store.getPublicProfile(
      user.id,
      PUBLIC_ACTIVITY_PAGE_SIZE
    )
    const body: PublicProfileResponse = profile
    return c.json(body)
  })

  app.get("/users/:handle/activities", async (c) => {
    const handle = c.req.param("handle")
    if (!isSafeHandle(handle)) return jsonError(c, "not_found", "Unknown user.")

    const user = await store.findUserByHandle(handle)
    if (!user) return jsonError(c, "not_found", "Unknown user.")

    const page = parsePage(c.req.query("page"))
    const body: PublicActivitiesPage = await store.listPublicActivities(
      user.id,
      page,
      PUBLIC_ACTIVITY_PAGE_SIZE
    )
    return c.json(body)
  })

  return app
}
