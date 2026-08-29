import { Hono } from "hono"
import { z } from "zod"

import type {
  SavedPointDeleteResponse,
  SavedPointUpsertResponse,
} from "~shared/api"
import {
  SAVED_POINT_COLORS,
  SAVED_POINT_DESCRIPTION_MAX_LENGTH,
  SAVED_POINT_NAME_MAX_LENGTH,
  normalizeSavedPointInput,
} from "~shared/saved-points"

import { createRequireSession, requireAllowed } from "../auth/middleware"
import type { AuthEnv } from "../auth/middleware"
import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"

const pointSchema = z.object({
  id: z.string().uuid(),
  lng: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
  name: z.string(),
  description: z.string().nullable(),
  color: z.enum(Object.keys(SAVED_POINT_COLORS) as [keyof typeof SAVED_POINT_COLORS, ...(keyof typeof SAVED_POINT_COLORS)[]]),
  isPublic: z.boolean(),
})

export function createSavedPointRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()
  app.use("*", createRequireSession(store), requireAllowed)

  app.get("/manifest", async (c) => {
    const raw = c.req.query("since")
    const since = raw === undefined ? 0 : Number(raw)
    if (!Number.isFinite(since) || since < 0) {
      return jsonError(c, "bad_request", "`since` must be a non-negative number.")
    }
    return c.json(await store.listSavedPointsManifest(c.get("user").id, since))
  })

  app.get("/", async (c) => c.json(await store.listSavedPoints(c.get("user").id)))

  app.put("/:id", async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return jsonError(c, "bad_request", "Body must be valid JSON.") }
    const parsed = pointSchema.safeParse(body)
    if (!parsed.success || parsed.data.id !== c.req.param("id")) {
      return jsonError(c, "bad_request", "Saved point is invalid.")
    }
    const point = normalizeSavedPointInput(parsed.data)
    if (!point.name || Array.from(point.name).length > SAVED_POINT_NAME_MAX_LENGTH) {
      return jsonError(c, "bad_request", "Name is required and must be 120 characters or fewer.")
    }
    if (point.description && Array.from(point.description).length > SAVED_POINT_DESCRIPTION_MAX_LENGTH) {
      return jsonError(c, "bad_request", "Description must be 2,000 characters or fewer.")
    }
    const existing = await store.listSavedPoints(c.get("user").id)
    if (!existing.some((savedPoint) => savedPoint.id === point.id) && existing.length >= 5_000) {
      return jsonError(c, "too_large", "A maximum of 5,000 saved points is allowed.")
    }
    const now = Date.now()
    const savedPoint = await store.upsertSavedPoint(c.get("user").id, { ...point, description: point.description ?? null, createdAt: now, updatedAt: now })
    const response: SavedPointUpsertResponse = { savedPoint }
    return c.json(response)
  })

  app.delete("/:id", async (c) => {
    if (!z.string().uuid().safeParse(c.req.param("id")).success) return jsonError(c, "bad_request", "Saved point id must be a UUID.")
    const deletedAt = await store.deleteSavedPoint(c.get("user").id, c.req.param("id"))
    const response: SavedPointDeleteResponse = { deletedAt }
    return c.json(response)
  })
  return app
}
