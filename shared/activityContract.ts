import type {
  ActivityCoords,
  ActivityGeometry,
  ActivityGeometryDraft,
  ActivityPathTimestamps,
  ActivityPaths,
} from "./activities"

export type ActivityNormalizationErrorCode =
  | "missing_geometry"
  | "conflicting_geometry"
  | "invalid_paths"
  | "invalid_coordinate"
  | "insufficient_points"
  | "invalid_timestamps"
  | "timestamp_mismatch"

export interface ActivityNormalizationError {
  code: ActivityNormalizationErrorCode
  message: string
  path?: string
}

export interface ActivityNormalizationWarning {
  code: "dropped_invalid_point" | "coalesced_duplicate_point" | "dropped_path"
  message: string
  path: string
}

export interface NormalizedActivityGeometry {
  ok: true
  geometry: ActivityGeometry
  warnings: ActivityNormalizationWarning[]
}

export interface RejectedActivityGeometry {
  ok: false
  error: ActivityNormalizationError
  warnings: ActivityNormalizationWarning[]
}

export type ActivityGeometryNormalizationResult =
  | NormalizedActivityGeometry
  | RejectedActivityGeometry

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isCoordinate(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const [lng, lat] = value
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

function isTimestamp(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function sameCoordinate(a: ActivityCoords[number], b: ActivityCoords[number]) {
  return Object.is(a[0], b[0]) && Object.is(a[1], b[1])
}

function error(
  code: ActivityNormalizationErrorCode,
  message: string,
  path?: string
): RejectedActivityGeometry {
  return { ok: false, error: { code, message, path }, warnings: [] }
}

/**
 * Normalize either legacy flat geometry or canonical path-aware geometry.
 * Invalid points split a path instead of being removed in the middle and
 * accidentally drawing a line across a discontinuity. Consecutive duplicates
 * are coalesced, retaining the first point's timestamp.
 */
export function normalizeActivityGeometry(
  input: ActivityGeometryDraft | unknown
): ActivityGeometryNormalizationResult {
  if (!isRecord(input)) {
    return error("missing_geometry", "Activity geometry must be an object.")
  }

  const hasCoordinates = input.coordinates !== undefined
  const hasPaths = input.paths !== undefined
  if (!hasCoordinates && !hasPaths) {
    return error(
      "missing_geometry",
      "Activity must contain coordinates or paths."
    )
  }
  if (hasCoordinates && hasPaths) {
    return error(
      "conflicting_geometry",
      "Activity must provide either coordinates or paths, not both."
    )
  }

  let rawPaths: unknown[]
  let rawTimestamps: unknown[] | undefined
  if (hasPaths) {
    if (!Array.isArray(input.paths) || input.paths.length === 0) {
      return error("invalid_paths", "Activity paths must be a non-empty array.")
    }
    rawPaths = input.paths
    const timestampValue = input.pathTimestamps
    if (timestampValue !== undefined && !Array.isArray(timestampValue)) {
      return error(
        "invalid_timestamps",
        "Path timestamps must be an array when provided."
      )
    }
    rawTimestamps = timestampValue
    if (
      rawTimestamps !== undefined &&
      rawTimestamps.length !== rawPaths.length
    ) {
      return error(
        "timestamp_mismatch",
        "There must be one timestamp array for each activity path."
      )
    }
  } else {
    if (!Array.isArray(input.coordinates)) {
      return error("invalid_paths", "Activity coordinates must be an array.")
    }
    rawPaths = [input.coordinates]
    rawTimestamps =
      input.pointTimestamps === undefined
        ? undefined
        : [input.pointTimestamps as unknown]
    if (rawTimestamps && !Array.isArray(input.pointTimestamps)) {
      return error(
        "invalid_timestamps",
        "Point timestamps must be an array when provided."
      )
    }
  }

  const warnings: ActivityNormalizationWarning[] = []
  const paths: ActivityPaths = []
  const pathTimestamps: ActivityPathTimestamps[] = []

  for (let pathIndex = 0; pathIndex < rawPaths.length; pathIndex += 1) {
    const rawPath = rawPaths[pathIndex]
    if (!Array.isArray(rawPath)) {
      return error(
        "invalid_paths",
        "Each activity path must be an array of coordinates.",
        `paths.${pathIndex}`
      )
    }

    const suppliedTimestamps = rawTimestamps?.[pathIndex]
    if (
      suppliedTimestamps !== undefined &&
      !Array.isArray(suppliedTimestamps)
    ) {
      return error(
        "invalid_timestamps",
        "Each path timestamp value must be an array.",
        `pathTimestamps.${pathIndex}`
      )
    }
    if (
      suppliedTimestamps !== undefined &&
      suppliedTimestamps.length !== rawPath.length
    ) {
      return error(
        "timestamp_mismatch",
        "Coordinate and timestamp arrays must remain aligned.",
        `pathTimestamps.${pathIndex}`
      )
    }

    let currentPath: ActivityCoords = []
    let currentTimestamps: ActivityPathTimestamps = []
    const flush = () => {
      if (currentPath.length >= 2) {
        paths.push(currentPath)
        if (rawTimestamps !== undefined) pathTimestamps.push(currentTimestamps)
      } else if (currentPath.length === 1) {
        warnings.push({
          code: "dropped_path",
          message: "A path with fewer than two usable points was dropped.",
          path: `paths.${pathIndex}`,
        })
      }
      currentPath = []
      currentTimestamps = []
    }

    for (let pointIndex = 0; pointIndex < rawPath.length; pointIndex += 1) {
      const point = rawPath[pointIndex]
      if (!isCoordinate(point)) {
        warnings.push({
          code: "dropped_invalid_point",
          message: "An invalid coordinate split the activity path.",
          path: `paths.${pathIndex}.${pointIndex}`,
        })
        flush()
        continue
      }

      const timestamp = suppliedTimestamps?.[pointIndex]
      if (timestamp !== undefined && !isTimestamp(timestamp)) {
        return error(
          "invalid_timestamps",
          "Timestamps must be finite numbers or null.",
          `pathTimestamps.${pathIndex}.${pointIndex}`
        )
      }

      const previous = currentPath[currentPath.length - 1]
      if (previous && sameCoordinate(previous, point)) {
        warnings.push({
          code: "coalesced_duplicate_point",
          message: "A consecutive duplicate coordinate was coalesced.",
          path: `paths.${pathIndex}.${pointIndex}`,
        })
        continue
      }
      currentPath.push([point[0], point[1]])
      if (rawTimestamps !== undefined) {
        // -1 is the legacy missing-timestamp sentinel used by the current
        // parsers; normalize it to the canonical nullable representation.
        currentTimestamps.push(timestamp === -1 ? null : (timestamp ?? null))
      }
    }
    flush()
  }

  if (paths.length === 0) {
    return error(
      "insufficient_points",
      "Activity must contain at least two usable points in one path."
    )
  }

  const geometry: ActivityGeometry = { paths }
  if (rawTimestamps !== undefined) geometry.pathTimestamps = pathTimestamps
  return { ok: true, geometry, warnings }
}

export function flattenActivityPaths(paths: ActivityPaths): ActivityCoords {
  return paths.flatMap((path) => path)
}
