import { HASH_COORD_PRECISION } from "~shared/constants"
import type { ParsedTrack } from "~/types/tracks"

/**
 * Content hash — the sync server's identity for a track, and the thing that
 * makes importing the same file twice a no-op instead of a duplicate.
 *
 * Derived only from geometry, deliberately:
 * - `name` is excluded, so renaming a file does not mint a new track.
 * - `id` is excluded — it is a per-device `crypto.randomUUID()`.
 * - `stats` is excluded; `uniqueDistanceKm` in particular is relative to
 *   whichever library computed it and shifts when unrelated tracks are added.
 *
 * The canonical string is duplicated in the server's upload handler, which
 * recomputes it to verify the hash a client claims. **Any change here is a
 * wire-format change and must be made on both sides at once.**
 */
export function canonicalTrackString(track: ParsedTrack): string {
  const head = `${track.format}|${track.startedAtMs ?? ""}|${track.coordinates.length}|`
  const body = track.coordinates
    .map(
      ([lng, lat]) =>
        `${lng.toFixed(HASH_COORD_PRECISION)},${lat.toFixed(HASH_COORD_PRECISION)}`
    )
    .join(";")
  return head + body
}

export async function computeContentHash(track: ParsedTrack): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalTrackString(track))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Fill in `contentHash` on any track that lacks one — tracks imported before
 * sync existed. Mutates in place and returns the tracks that changed, so the
 * caller can persist just those.
 */
export async function backfillContentHashes(
  tracks: ParsedTrack[]
): Promise<ParsedTrack[]> {
  const changed: ParsedTrack[] = []
  for (const track of tracks) {
    if (track.contentHash) continue
    track.contentHash = await computeContentHash(track)
    changed.push(track)
  }
  return changed
}
