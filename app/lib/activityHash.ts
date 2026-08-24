import { HASH_COORD_PRECISION } from "~shared/constants"
import type { ParsedActivity } from "~/types/activities"

/**
 * Content hash — the sync server's identity for an activity, and the thing that
 * makes importing the same file twice a no-op instead of a duplicate.
 *
 * Derived only from geometry, deliberately:
 * - `name` is excluded, so renaming a file does not mint a new activity.
 * - `id` is excluded — it is a per-device `crypto.randomUUID()`.
 * - `stats` is excluded; `uniqueDistanceKm` in particular is relative to
 *   whichever library computed it and shifts when unrelated activities are added.
 *
 * The canonical string is duplicated in the server's upload handler, which
 * recomputes it to verify the hash a client claims. **Any change here is a
 * wire-format change and must be made on both sides at once.**
 */
export function canonicalActivityString(activity: ParsedActivity): string {
  const head = `${activity.format}|${activity.startedAtMs ?? ""}|${activity.coordinates.length}|`
  const body = activity.coordinates
    .map(
      ([lng, lat]) =>
        `${lng.toFixed(HASH_COORD_PRECISION)},${lat.toFixed(HASH_COORD_PRECISION)}`
    )
    .join(";")
  return head + body
}

export async function computeContentHash(
  activity: ParsedActivity
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalActivityString(activity))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Fill in `contentHash` on any activity that lacks one — activities imported before
 * sync existed. Mutates in place and returns the activities that changed, so the
 * caller can persist just those.
 */
export async function backfillContentHashes(
  activities: ParsedActivity[]
): Promise<ParsedActivity[]> {
  const changed: ParsedActivity[] = []
  for (const activity of activities) {
    if (activity.contentHash) continue
    activity.contentHash = await computeContentHash(activity)
    changed.push(activity)
  }
  return changed
}
