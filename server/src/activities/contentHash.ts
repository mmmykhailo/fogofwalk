/**
 * Server-side recomputation of an activity's content hash.
 *
 * The client sends the hash in the URL, but the server must never take its
 * word for it: the hash is the primary key, so a client that could declare an
 * arbitrary one could overwrite another device's activity with different
 * geometry. Recomputing from the payload and rejecting mismatches is what
 * makes the key trustworthy.
 *
 * The canonical form must stay byte-identical to `app/lib/activityHash.ts`.
 */

import { HASH_COORD_PRECISION } from "~shared/constants"
import type { ActivityCoords, ActivityFormat } from "~shared/activities"

export interface HashInput {
  format: ActivityFormat
  startedAtMs: number | null
  coordinates: ActivityCoords
}

export function canonicalHashString(activity: HashInput): string {
  const points = activity.coordinates
    .map(
      ([lng, lat]) =>
        `${lng.toFixed(HASH_COORD_PRECISION)},${lat.toFixed(HASH_COORD_PRECISION)}`
    )
    .join(";")
  return `${activity.format}|${activity.startedAtMs ?? ""}|${activity.coordinates.length}|${points}`
}

export async function computeContentHash(activity: HashInput): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalHashString(activity))
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export const CONTENT_HASH_RE = /^[a-f0-9]{64}$/

export function isContentHash(value: string): boolean {
  return CONTENT_HASH_RE.test(value)
}
