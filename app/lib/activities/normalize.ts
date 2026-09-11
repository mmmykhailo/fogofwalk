import type { ActivityDraft, CanonicalActivity } from "~shared/activities"
import {
  normalizeActivityGeometry,
  type ActivityGeometryNormalizationResult,
  type ActivityNormalizationWarning,
} from "~shared/activityContract"
import { canonicalActivityIdentityString } from "~shared/activityIdentity"
import { createUuid } from "~/lib/uuid"

export type {
  ActivityNormalizationError,
  ActivityNormalizationErrorCode,
  ActivityNormalizationWarning,
  ActivityGeometryNormalizationResult,
} from "~shared/activityContract"

export interface NormalizedActivityResult {
  ok: true
  activity: CanonicalActivity
  warnings: ActivityNormalizationWarning[]
}

export interface RejectedActivityResult {
  ok: false
  error: Extract<ActivityGeometryNormalizationResult, { ok: false }>["error"]
  warnings: Extract<
    ActivityGeometryNormalizationResult,
    { ok: false }
  >["warnings"]
}

export type ActivityNormalizationResult =
  | NormalizedActivityResult
  | RejectedActivityResult

/**
 * Convert parser-shaped legacy or path-aware input into the canonical activity
 * shape. This is deliberately independent of persistence and fog work.
 */
export function normalizeActivity(
  draft: ActivityDraft
): ActivityNormalizationResult {
  const geometry = normalizeActivityGeometry(draft)
  if (!geometry.ok) return geometry

  const {
    coordinates: _coordinates,
    pointTimestamps: _pointTimestamps,
    paths: _paths,
    pathTimestamps: _pathTimestamps,
    contentHash: _contentHash,
    ...metadata
  } = draft

  return {
    ok: true,
    activity: {
      ...metadata,
      id: draft.id ?? createUuid(),
      ...geometry.geometry,
    },
    warnings: geometry.warnings,
  }
}

function digestToHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function computeCanonicalActivityHash(
  activity: CanonicalActivity
): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonicalActivityIdentityString(activity)
  )
  return digestToHex(await crypto.subtle.digest("SHA-256", bytes))
}

/** Normalize a draft and stamp its v2 path-aware content identity. */
export async function normalizeAndHashActivity(
  draft: ActivityDraft
): Promise<
  | (Extract<NormalizedActivityResult, { ok: true }> & {
      activity: CanonicalActivity & { contentHash: string }
    })
  | Extract<RejectedActivityResult, { ok: false }>
> {
  const normalized = normalizeActivity(draft)
  if (!normalized.ok) return normalized
  return {
    ...normalized,
    activity: {
      ...normalized.activity,
      contentHash: await computeCanonicalActivityHash(normalized.activity),
    },
  }
}
