/**
 * Activity sync. Every route here is behind `requireSession` +
 * `requireAllowed` and is scoped to `c.var.user.id`; the store interface has
 * no cross-user read path, so a hash belonging to somebody else is a 404 and
 * never a 200.
 *
 *   GET    /api/activities/manifest?since=<cursor>
 *   PUT    /api/activities/:contentHash    gzipped ActivityUploadPayload
 *   GET    /api/activities/:contentHash    the gzipped blob, verbatim
 *   DELETE /api/activities/:contentHash    row + blob + tombstone
 */

import { Hono } from "hono"
import { z } from "zod"

import type {
  ActivityDeleteResponse,
  ActivityMeta,
  ActivityVisibilityUpdateResponse,
} from "~shared/api"

import { createRequireSession, requireAllowed } from "../auth/middleware"
import type { AuthEnv } from "../auth/middleware"
import { jsonError, rateLimited } from "../errors"
import type { ServerStore } from "../store/types"
import {
  BodyTooLargeError,
  gunzipCapped,
  looksGzipped,
  readCappedBody,
} from "./body"
import { computeContentHash, isContentHash } from "./contentHash"
import { parseActivityUpload } from "./payload"
import { checkRateLimit } from "./rateLimit"

const visibilitySchema = z.object({
  isPublic: z.boolean(),
})

export function createActivityRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()

  app.use("*", createRequireSession(store), requireAllowed)

  app.get("/manifest", async (c) => {
    const raw = c.req.query("since")
    const since = raw === undefined ? 0 : Number(raw)
    if (!Number.isFinite(since) || since < 0) {
      return jsonError(
        c,
        "bad_request",
        "`since` must be a non-negative number."
      )
    }
    return c.json(await store.listManifest(c.get("user").id, since))
  })

  app.put("/:contentHash", async (c) => {
    const user = c.get("user")
    const contentHash = c.req.param("contentHash")

    if (!isContentHash(contentHash)) {
      return jsonError(c, "bad_request", "Content hash must be 64 hex digits.")
    }
    const limit = checkRateLimit(user.id)
    if (!limit.ok) {
      return rateLimited(
        c,
        "Too many uploads. Try again shortly.",
        limit.retryAfterMs
      )
    }

    let stored: Uint8Array<ArrayBuffer>
    let json: string
    try {
      // Capped while reading, not after — see readCappedBody.
      const body = await readCappedBody(c.req.raw)
      if (body.byteLength === 0) {
        return jsonError(c, "bad_request", "Empty body.")
      }

      // Detect by magic number rather than by Content-Encoding: a proxy that
      // decompresses the body on the way in leaves the header behind.
      const gzipped = looksGzipped(body)
      const plain = gzipped ? await gunzipCapped(body) : body
      stored = gzipped ? body : Bun.gzipSync(body)
      json = new TextDecoder().decode(plain)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return jsonError(c, "too_large", "Activity exceeds the size limit.")
      }
      return jsonError(c, "bad_request", "Body is not valid gzip.")
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(json)
    } catch {
      return jsonError(c, "bad_request", "Body is not valid JSON.")
    }

    const parsed = parseActivityUpload(parsedJson)
    if (!parsed.ok) return jsonError(c, "bad_request", parsed.message)

    const activity = parsed.activity
    const actual = await computeContentHash({
      format: activity.format,
      startedAtMs: activity.startedAtMs,
      coordinates: activity.coordinates,
    })
    if (actual !== contentHash) {
      // The hash is the primary key; accepting a declared one would let any
      // client overwrite another device's activity with unrelated geometry.
      return jsonError(
        c,
        "bad_request",
        "Content hash does not match the uploaded geometry."
      )
    }

    // Re-uploading identical geometry keeps the original `updatedAt`, so an
    // idempotent retry does not churn every other device's manifest. A row
    // that was deleted has no `existing`, so a resurrect gets a fresh
    // timestamp and does propagate.
    const existing = await store.getActivity(user.id, contentHash)
    const meta: ActivityMeta = {
      contentHash,
      name: activity.name,
      isPublic: activity.isPublic ?? false,
      format: activity.format,
      startedAtMs: activity.startedAtMs,
      distanceKm: activity.stats.distanceKm,
      pointCount: activity.coordinates.length,
      sizeBytes: stored.byteLength,
      updatedAt: existing?.updatedAt ?? Date.now(),
      durationMs: activity.stats.durationMs,
      movingTimeMs: activity.stats.movingTimeMs,
      elevationGainM: activity.stats.elevationGainM,
      avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
    }

    await store.putActivity(user.id, meta, stored)
    return c.json(meta)
  })

  app.get("/:contentHash", async (c) => {
    const contentHash = c.req.param("contentHash")
    if (!isContentHash(contentHash)) return jsonError(c, "not_found")

    const blob = await store.getActivityBlob(c.get("user").id, contentHash)
    if (!blob) return jsonError(c, "not_found")

    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Cache-Control": "private, no-store",
      },
    })
  })

  app.patch("/:contentHash/visibility", async (c) => {
    const user = c.get("user")
    const contentHash = c.req.param("contentHash")
    if (!isContentHash(contentHash)) {
      return jsonError(c, "bad_request", "Content hash must be 64 hex digits.")
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, "bad_request", "Expected a JSON body.")
    }

    const parsed = visibilitySchema.safeParse(body)
    if (!parsed.success) {
      return jsonError(c, "bad_request", "isPublic must be a boolean.")
    }

    const updated = await store.setActivityVisibility(
      user.id,
      contentHash,
      parsed.data.isPublic
    )
    if (!updated) {
      return jsonError(c, "not_found")
    }

    const response: ActivityVisibilityUpdateResponse = {
      contentHash: updated.contentHash,
      isPublic: updated.isPublic,
      updatedAt: updated.updatedAt,
    }
    return c.json(response)
  })

  /**
   * Wipe every activity this user has on the server, keeping the account.
   *
   * Writes no tombstones on purpose: this is "clear the server", not "delete
   * everywhere". Devices keep their local libraries. Registered before
   * `/:contentHash` so the bare path is not swallowed as a hash.
   */
  app.delete("/", async (c) => {
    const deleted = await store.purgeActivities(c.get("user").id)
    return c.json({ deleted })
  })

  app.delete("/:contentHash", async (c) => {
    const contentHash = c.req.param("contentHash")
    if (!isContentHash(contentHash)) {
      return jsonError(c, "bad_request", "Content hash must be 64 hex digits.")
    }
    // Idempotent: deleting an unknown hash still writes the tombstone, so a
    // retry after a dropped response is a no-op rather than an error.
    const deletedAt = await store.deleteActivity(c.get("user").id, contentHash)
    // The timestamp goes back so the deleting device can mark its own tombstone
    // as applied; otherwise its next sync deletes a re-imported copy.
    return c.json({ deletedAt } satisfies ActivityDeleteResponse)
  })

  return app
}
