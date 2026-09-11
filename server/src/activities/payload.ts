/**
 * Runtime validation of the upload body.
 *
 * The schema mirrors `ActivityUploadRequestPayload`, so if a field is
 * added to `shared/activities.ts` and not mirrored here, `bun run typecheck`
 * fails — the shared declaration stays the single source of truth and this
 * file stays its runtime shadow, rather than a second, drifting copy.
 */

import { z } from "zod"

import type { ActivityUploadRequestPayload } from "~shared/api"

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

const activityUploadSchema = z
  .object({
    name: z.string().min(1).max(512),
    startedAtMs: finite.nullable(),
    // Legacy clients send one flat path. New clients send disconnected paths.
    coordinates: z.array(coordinateSchema).min(1).optional(),
    paths: z.array(z.array(coordinateSchema).min(2)).min(1).optional(),
    pointTimestamps: z.array(finite).optional(),
    pathTimestamps: z.array(z.array(finite.nullable())).optional(),
    format: z.union([z.literal("gpx"), z.literal("fit")]),
    activityType: z
      .enum(["walking", "running", "cycling", "kayaking", "swimming", "other"])
      .optional(),
    startSunPhase: z
      .enum(["before_sunrise", "daylight", "after_sunset", "unknown"])
      .optional(),
    stats: statsSchema,
    laps: z.array(lapSchema).optional(),
    contentHash: z.string().optional(),
    isPublic: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.coordinates === undefined && value.paths === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinates"],
        message: "Activity must contain coordinates or paths.",
      })
    }
    if (value.coordinates !== undefined && value.paths !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paths"],
        message: "Activity must provide either coordinates or paths, not both.",
      })
    }
    if (value.paths !== undefined && value.pointTimestamps !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointTimestamps"],
        message: "Path-aware payloads must use pathTimestamps.",
      })
    }
    if (value.coordinates !== undefined && value.pathTimestamps !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathTimestamps"],
        message: "Legacy payloads must use pointTimestamps.",
      })
    }
    if (
      value.paths !== undefined &&
      value.pathTimestamps !== undefined &&
      value.paths.length !== value.pathTimestamps.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathTimestamps"],
        message: "There must be one timestamp array for each activity path.",
      })
    }
    if (
      value.coordinates !== undefined &&
      value.pointTimestamps !== undefined &&
      value.coordinates.length !== value.pointTimestamps.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointTimestamps"],
        message: "Coordinate and timestamp arrays must remain aligned.",
      })
    }
    if (
      value.paths !== undefined &&
      value.pathTimestamps !== undefined &&
      value.paths.some(
        (path, index) => path.length !== value.pathTimestamps?.[index]?.length
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathTimestamps"],
        message: "Coordinate and timestamp arrays must remain aligned.",
      })
    }
  })

export function parseActivityUpload(
  value: unknown
):
  | { ok: true; activity: ActivityUploadRequestPayload }
  | { ok: false; message: string } {
  const result = activityUploadSchema.safeParse(value)
  if (result.success) {
    return { ok: true, activity: result.data as ActivityUploadRequestPayload }
  }

  const issue = result.error.issues[0]
  return {
    ok: false,
    message: issue
      ? `${issue.path.join(".") || "body"}: ${issue.message}`
      : "Malformed activity payload.",
  }
}
