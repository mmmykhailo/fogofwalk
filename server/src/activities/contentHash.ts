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

import type {
  ActivityCoords,
  ActivityFormat,
  ActivityPaths,
} from "~shared/activities"
import {
  canonicalActivityIdentityString,
  isContentHash,
  type ActivityIdentityInput,
} from "~shared/activityIdentity"

export interface HashInput {
  format: ActivityFormat
  startedAtMs: number | null
  coordinates?: ActivityCoords
  paths?: ActivityPaths
}

export function canonicalHashString(activity: HashInput): string {
  return canonicalActivityIdentityString(activity)
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

/** Both v1 and v2 hashes are accepted while legacy payloads are migrated. */
export async function computeContentHashCandidates(
  activity: HashInput
): Promise<string[]> {
  const inputs: ActivityIdentityInput[] = [activity]
  if (activity.paths?.length === 1) {
    inputs.push({
      format: activity.format,
      startedAtMs: activity.startedAtMs,
      coordinates: activity.paths[0],
    })
  }
  return Promise.all(
    inputs.map(async (input) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalActivityIdentityString(input))
      )
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    })
  )
}

export async function contentHashMatches(
  activity: HashInput,
  expected: string
): Promise<boolean> {
  return (await computeContentHashCandidates(activity)).includes(expected)
}

export { isContentHash }
