/**
 * Track sync (plan §3). Every route here is behind `requireSession` +
 * `requireAllowed` and is scoped to `c.var.user.id`; the store interface has
 * no cross-user read path, so a hash belonging to somebody else is a 404 and
 * never a 200.
 *
 *   GET    /api/tracks/manifest?since=<cursor>
 *   PUT    /api/tracks/:contentHash    gzipped TrackUploadPayload
 *   GET    /api/tracks/:contentHash    the gzipped blob, verbatim
 *   DELETE /api/tracks/:contentHash    row + blob + tombstone
 */

import { Hono } from "hono"

import type { TrackDeleteResponse, TrackMeta } from "~shared/api"

import { createRequireSession, requireAllowed } from "../auth/middleware"
import type { AuthEnv } from "../auth/middleware"
import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"
import {
  BodyTooLargeError,
  gunzipCapped,
  looksGzipped,
  readCappedBody,
} from "./body"
import { computeContentHash, isContentHash } from "./contentHash"
import { parseTrackUpload } from "./payload"
import { checkRateLimit } from "./rateLimit"

export function createTrackRoutes(store: ServerStore) {
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
    if (!checkRateLimit(user.id)) {
      return jsonError(
        c,
        "rate_limited",
        "Too many uploads. Try again shortly."
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
        return jsonError(c, "too_large", "Track exceeds the size limit.")
      }
      return jsonError(c, "bad_request", "Body is not valid gzip.")
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(json)
    } catch {
      return jsonError(c, "bad_request", "Body is not valid JSON.")
    }

    const parsed = parseTrackUpload(parsedJson)
    if (!parsed.ok) return jsonError(c, "bad_request", parsed.message)

    const track = parsed.track
    const actual = await computeContentHash({
      format: track.format,
      startedAtMs: track.startedAtMs,
      coordinates: track.coordinates,
    })
    if (actual !== contentHash) {
      // The hash is the primary key; accepting a declared one would let any
      // client overwrite another device's track with unrelated geometry.
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
    const existing = await store.getTrack(user.id, contentHash)
    const meta: TrackMeta = {
      contentHash,
      name: track.name,
      format: track.format,
      startedAtMs: track.startedAtMs,
      distanceKm: track.stats.distanceKm,
      pointCount: track.coordinates.length,
      sizeBytes: stored.byteLength,
      updatedAt: existing?.updatedAt ?? Date.now(),
    }

    await store.putTrack(user.id, meta, stored)
    return c.json(meta)
  })

  app.get("/:contentHash", async (c) => {
    const contentHash = c.req.param("contentHash")
    if (!isContentHash(contentHash)) return jsonError(c, "not_found")

    const blob = await store.getTrackBlob(c.get("user").id, contentHash)
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

  /**
   * Wipe every track this user has on the server, keeping the account.
   *
   * Writes no tombstones on purpose: this is "clear the server", not "delete
   * everywhere". Devices keep their local libraries. Registered before
   * `/:contentHash` so the bare path is not swallowed as a hash.
   */
  app.delete("/", async (c) => {
    const deleted = await store.purgeTracks(c.get("user").id)
    return c.json({ deleted })
  })

  app.delete("/:contentHash", async (c) => {
    const contentHash = c.req.param("contentHash")
    if (!isContentHash(contentHash)) {
      return jsonError(c, "bad_request", "Content hash must be 64 hex digits.")
    }
    // Idempotent: deleting an unknown hash still writes the tombstone, so a
    // retry after a dropped response is a no-op rather than an error.
    const deletedAt = await store.deleteTrack(c.get("user").id, contentHash)
    // The timestamp goes back so the deleting device can mark its own tombstone
    // as applied; otherwise its next sync deletes a re-imported copy.
    return c.json({ deletedAt } satisfies TrackDeleteResponse)
  })

  return app
}
