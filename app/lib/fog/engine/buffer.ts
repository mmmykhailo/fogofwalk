import buffer from "@turf/buffer"
import { lineString } from "@turf/helpers"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import type { FogWorkerActivity } from "~/types/activities"
import { sanitizeFogInput, type FogInputWarning } from "./input"

export type FogMask = Feature<Polygon | MultiPolygon>

export interface FogActivityMaskResult {
  activityId: string
  activityName: string
  masks: FogMask[]
  warnings: FogInputWarning[]
  inputPointCount: number
  outputPointCount: number
  rejected: boolean
  reason?: string
}

export interface FogBufferOptions {
  radiusMeters?: number
  steps?: number
}

const DEFAULT_RADIUS_METERS = 100
const DEFAULT_BUFFER_STEPS = 8

/**
 * Sanitize and buffer every disconnected path independently.  This boundary
 * is the only place where route coordinates become positive explored masks;
 * no caller can accidentally flatten two source paths into one corridor.
 */
export function bufferFogActivity(
  activity: FogWorkerActivity,
  options: FogBufferOptions = {}
): FogActivityMaskResult {
  const input = sanitizeFogInput(activity)
  const masks: FogMask[] = []
  const radiusMeters = options.radiusMeters ?? DEFAULT_RADIUS_METERS
  const steps = options.steps ?? DEFAULT_BUFFER_STEPS

  if (input.rejected) {
    return {
      activityId: activity.id,
      activityName: activity.name,
      masks,
      warnings: input.warnings,
      inputPointCount: input.inputPointCount,
      outputPointCount: input.outputPointCount,
      rejected: true,
      reason: input.reason,
    }
  }

  for (const path of input.paths) {
    try {
      const result = buffer(lineString(path), radiusMeters, {
        units: "meters",
        steps,
      })
      if (result) masks.push(result as FogMask)
    } catch (error) {
      return {
        activityId: activity.id,
        activityName: activity.name,
        masks,
        warnings: input.warnings,
        inputPointCount: input.inputPointCount,
        outputPointCount: input.outputPointCount,
        rejected: true,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    activityId: activity.id,
    activityName: activity.name,
    masks,
    warnings: input.warnings,
    inputPointCount: input.inputPointCount,
    outputPointCount: input.outputPointCount,
    rejected: masks.length === 0,
    ...(masks.length === 0 ? { reason: "no_usable_paths" } : {}),
  }
}
