import type { CanonicalActivity, ParsedActivity } from "~shared/activities"
import {
  canonicalActivityIdentityString,
  isContentHash,
  type ActivityIdentityInput,
} from "~shared/activityIdentity"

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
export function canonicalActivityString(
  activity: ParsedActivity | CanonicalActivity
): string {
  return canonicalActivityIdentityString(activity)
}

export async function computeContentHash(
  activity: ParsedActivity | CanonicalActivity
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalActivityString(activity))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Return both identity versions accepted during the path migration. */
export async function computeContentHashCandidates(
  activity: ParsedActivity | CanonicalActivity
): Promise<string[]> {
  const inputs: ActivityIdentityInput[] = [activity]
  if ("paths" in activity && activity.paths.length === 1) {
    inputs.push({
      format: activity.format,
      startedAtMs: activity.startedAtMs,
      coordinates: activity.paths[0],
    })
  }
  return Promise.all(
    inputs.map(async (input) => {
      const bytes = new TextEncoder().encode(
        canonicalActivityIdentityString(input)
      )
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    })
  )
}

export { isContentHash }

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
