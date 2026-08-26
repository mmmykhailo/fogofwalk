/**
 * Runtime validation of the upload body.
 *
 * The schema is annotated `z.ZodType<ActivityUploadPayload>`, so if a field is
 * added to `shared/activities.ts` and not mirrored here, `bun run typecheck`
 * fails — the shared declaration stays the single source of truth and this
 * file stays its runtime shadow, rather than a second, drifting copy.
 */

import { z } from "zod"

import type { ActivityUploadPayload } from "~shared/api"

const finite = z.number().finite()

const elevationPointSchema = z.object({
  distanceKm: finite,
  elevationM: finite,
})

const statsSchema = z.object({
  distanceKm: finite,
  uniqueDistanceKm: finite,
  elevationGainM: finite,
  elevationLossM: finite,
  hasElevation: z.boolean(),
  durationMs: finite.nullable(),
  movingTimeMs: finite.nullable(),
  avgPaceMinPerKm: finite.nullable(),
  avgMovingPaceMinPerKm: finite.nullable(),
  avgSpeedKmh: finite.nullable(),
  avgMovingSpeedKmh: finite.nullable(),
  elevationProfile: z.array(elevationPointSchema),
})

const lapSchema = z.object({
  number: z.number().int(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  startedAtMs: finite.nullable(),
  trigger: z.string().optional(),
  stats: statsSchema,
})

const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
])

export const activityUploadSchema: z.ZodType<ActivityUploadPayload> = z.object({
  name: z.string().min(1).max(512),
  startedAtMs: finite.nullable(),
  // An activity with no geometry has no identity — the hash would be a constant.
  coordinates: z.array(coordinateSchema).min(1),
  pointTimestamps: z.array(finite).optional(),
  format: z.union([z.literal("gpx"), z.literal("fit")]),
  activityType: z
    .enum(["walking", "running", "cycling", "kayaking", "swimming", "other"])
    .optional(),
  stats: statsSchema,
  laps: z.array(lapSchema).optional(),
  contentHash: z.string().optional(),
  isPublic: z.boolean().optional(),
})

export function parseActivityUpload(
  value: unknown
):
  | { ok: true; activity: ActivityUploadPayload }
  | { ok: false; message: string } {
  const result = activityUploadSchema.safeParse(value)
  if (result.success) return { ok: true, activity: result.data }

  const issue = result.error.issues[0]
  return {
    ok: false,
    message: issue
      ? `${issue.path.join(".") || "body"}: ${issue.message}`
      : "Malformed activity payload.",
  }
}
