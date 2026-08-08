/**
 * Server-side recomputation of a track's content hash (plan §4).
 *
 * The client sends the hash in the URL, but the server must never take its
 * word for it: the hash is the primary key, so a client that could declare an
 * arbitrary one could overwrite another device's track with different
 * geometry. Recomputing from the payload and rejecting mismatches is what
 * makes the key trustworthy.
 *
 * The canonical form must stay byte-identical to `app/lib/trackHash.ts`.
 */

import { HASH_COORD_PRECISION } from "~shared/constants"
import type { TrackCoords, TrackFormat } from "~shared/tracks"

export interface HashInput {
  format: TrackFormat
  startedAtMs: number | null
  coordinates: TrackCoords
}

export function canonicalHashString(track: HashInput): string {
  const points = track.coordinates
    .map(
      ([lng, lat]) =>
        `${lng.toFixed(HASH_COORD_PRECISION)},${lat.toFixed(HASH_COORD_PRECISION)}`
    )
    .join(";")
  return `${track.format}|${track.startedAtMs ?? ""}|${track.coordinates.length}|${points}`
}

export async function computeContentHash(track: HashInput): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalHashString(track))
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export const CONTENT_HASH_RE = /^[a-f0-9]{64}$/

export function isContentHash(value: string): boolean {
  return CONTENT_HASH_RE.test(value)
}
