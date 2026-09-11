import type {
  ActivityCoords,
  ActivityGeometry,
  ActivityPathTimestamps,
  ActivityPaths,
  CanonicalActivity,
  ParsedActivity,
} from "~shared/activities"
import { ACTIVITY_SIMPLIFY_TOLERANCE } from "~/constants/fog"

/**
 * These are safety limits for the geometry engine, not product import limits.
 * They may be made adaptive after the phase-0 measurements in the refactor
 * plan.  In particular, the emission tolerance is deliberately not imported
 * here: input simplification and emitted-fog simplification are separate jobs.
 */
export const FOG_INPUT_DEFAULTS = {
  duplicateToleranceMeters: 0.5,
  teleportThresholdMeters: 250_000,
  maxPointsPerPath: 100_000,
  maxTotalPoints: 250_000,
  maxLatitude: 85.05112878,
  activitySimplifyToleranceDegrees: ACTIVITY_SIMPLIFY_TOLERANCE,
} as const

export type FogInputWarningCode =
  | "dropped_invalid_point"
  | "clamped_latitude"
  | "coalesced_duplicate_point"
  | "split_teleport"
  | "split_antimeridian"
  | "dropped_path"
  | "simplified_path"
  | "point_budget_exceeded"

export interface FogInputWarning {
  code: FogInputWarningCode
  message: string
  pathIndex: number
  pointIndex?: number
}

export interface FogInputOptions {
  /** Coalesce points no farther apart than this distance. */
  duplicateToleranceMeters?: number
  /** Start a new path instead of buffering a segment longer than this. */
  teleportThresholdMeters?: number
  /** Technical safety budget after input simplification. */
  maxPointsPerPath?: number
  /** Technical safety budget across all emitted input paths. */
  maxTotalPoints?: number
  /** Clamp latitude to the supported Web Mercator range. */
  maxLatitude?: number
  /** Activity simplification tolerance, independent from fog emission tolerance. */
  activitySimplifyToleranceDegrees?: number
}

export interface SanitizedFogInput {
  paths: ActivityPaths
  pathTimestamps?: ActivityPathTimestamps[]
  warnings: FogInputWarning[]
  /** Exact event totals; warnings is only a bounded example list. */
  warningCounts: Record<string, number>
  inputPointCount: number
  outputPointCount: number
}

export interface RejectedFogInput extends SanitizedFogInput {
  rejected: true
  reason: "invalid_timestamps" | "no_usable_paths" | "point_budget_exceeded"
}

export interface AcceptedFogInput extends SanitizedFogInput {
  rejected: false
}

export type FogInputResult = AcceptedFogInput | RejectedFogInput

type Timestamp = number | null

interface InputPoint {
  lng: number
  unwrappedLng: number
  lat: number
  timestamp: Timestamp | undefined
}

interface OutputPoint {
  coordinate: [number, number]
  timestamp: Timestamp | undefined
}

const MAX_WARNING_EXAMPLES = 16

interface WarningCollector {
  examples: FogInputWarning[]
  counts: Record<string, number>
}

function addWarning(
  collector: WarningCollector,
  warning: FogInputWarning
): void {
  collector.counts[warning.code] = (collector.counts[warning.code] ?? 0) + 1
  if (collector.examples.length < MAX_WARNING_EXAMPLES) {
    collector.examples.push(warning)
  }
}

export type FogGeometryInput =
  | ParsedActivity
  | CanonicalActivity
  | ActivityGeometry
  | Pick<ParsedActivity, "coordinates" | "pointTimestamps">

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  )
}

function wrapLongitude(longitude: number): number {
  if (longitude >= -180 && longitude <= 180) return longitude
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180
  // Retain a positive 180 supplied at a non-crossing endpoint.  The edge
  // representation is selected explicitly while splitting a segment.
  return wrapped === -180 && longitude > 0 ? 180 : wrapped
}

function shortestLongitudeDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

function haversineMeters(
  first: [number, number],
  second: [number, number]
): number {
  const radians = Math.PI / 180
  const latitude1 = first[1] * radians
  const latitude2 = second[1] * radians
  const deltaLatitude = (second[1] - first[1]) * radians
  const deltaLongitude = shortestLongitudeDelta(first[0], second[0]) * radians
  const sinLatitude = Math.sin(deltaLatitude / 2)
  const sinLongitude = Math.sin(deltaLongitude / 2)
  const a =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function interpolateTimestamp(
  first: Timestamp | undefined,
  second: Timestamp | undefined,
  fraction: number
): Timestamp | undefined {
  if (first === undefined || second === undefined) return undefined
  if (first === null || second === null) return null
  return first + (second - first) * fraction
}

function isBoundary(longitude: number): boolean {
  return longitude === 180 || longitude === -180
}

function boundaryLongitudeForPoint(
  point: InputPoint,
  direction: number
): number {
  if (!isBoundary(point.lng)) return point.lng
  if (direction > 0) return -180
  if (direction < 0) return 180
  return point.lng
}

function pointDistanceToSegmentMeters(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  // Equirectangular metres are sufficiently stable for the small local
  // deviations used by RDP.  Antimeridian pieces have already been split.
  const radians = Math.PI / 180
  const latitude = ((start[1] + end[1] + point[1]) / 3) * radians
  const scaleX = 6_371_008.8 * Math.cos(latitude) * radians
  const scaleY = 6_371_008.8 * radians
  const px = point[0] * scaleX
  const py = point[1] * scaleY
  const sx = start[0] * scaleX
  const sy = start[1] * scaleY
  const ex = end[0] * scaleX
  const ey = end[1] * scaleY
  const dx = ex - sx
  const dy = ey - sy
  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy)
  const projection = Math.max(
    0,
    Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy))
  )
  return Math.hypot(px - (sx + projection * dx), py - (sy + projection * dy))
}

function simplifyPath(
  points: OutputPoint[],
  toleranceDegrees: number
): OutputPoint[] {
  if (points.length < 3 || toleranceDegrees <= 0) return points
  const toleranceMeters = toleranceDegrees * 111_320
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const segments: [number, number][] = [[0, points.length - 1]]
  while (segments.length > 0) {
    const [start, end] = segments.pop()!
    if (end - start < 2) continue
    let furthest = -1
    let distance = toleranceMeters
    const startCoordinate = points[start].coordinate
    const endCoordinate = points[end].coordinate
    for (let index = start + 1; index < end; index += 1) {
      const candidate = pointDistanceToSegmentMeters(
        points[index].coordinate,
        startCoordinate,
        endCoordinate
      )
      if (candidate > distance) {
        furthest = index
        distance = candidate
      }
    }
    if (furthest === -1) continue
    keep[furthest] = 1
    segments.push([start, furthest], [furthest, end])
  }
  return points.filter((_, index) => keep[index] === 1)
}

function reduceToBudget(
  points: OutputPoint[],
  budget: number
): { points: OutputPoint[]; reduced: boolean } {
  if (points.length <= budget) return { points, reduced: false }
  if (budget < 2) return { points: [], reduced: true }

  // Keep both endpoints and choose evenly spaced interior samples.  This is a
  // last-resort technical guard after RDP; it is deterministic and cannot
  // create a bridge between separate paths.
  const result: OutputPoint[] = [points[0]]
  const interiorCount = budget - 2
  for (let index = 1; index <= interiorCount; index += 1) {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (interiorCount + 1)
    )
    result.push(points[sourceIndex])
  }
  result.push(points[points.length - 1])
  return { points: result, reduced: true }
}

function makeResult(
  paths: ActivityPaths,
  pathTimestamps: ActivityPathTimestamps[] | undefined,
  warningCollector: WarningCollector,
  inputPointCount: number,
  reason?: RejectedFogInput["reason"]
): FogInputResult {
  const outputPointCount = paths.reduce((total, path) => total + path.length, 0)
  if (reason) {
    return {
      rejected: true,
      reason,
      paths,
      pathTimestamps,
      warnings: warningCollector.examples,
      warningCounts: warningCollector.counts,
      inputPointCount,
      outputPointCount,
    }
  }
  return {
    rejected: false,
    paths,
    pathTimestamps,
    warnings: warningCollector.examples,
    warningCounts: warningCollector.counts,
    inputPointCount,
    outputPointCount,
  }
}

function readGeometry(input: FogGeometryInput): {
  paths: unknown[]
  timestamps: unknown[] | undefined
} {
  if (isRecord(input) && "paths" in input && Array.isArray(input.paths)) {
    const pathTimestamps =
      "pathTimestamps" in input ? input.pathTimestamps : undefined
    return {
      paths: input.paths,
      // Keep malformed timestamp values visible to the validator below rather
      // than silently treating them as an activity with no timestamps.
      timestamps:
        pathTimestamps === undefined
          ? undefined
          : Array.isArray(pathTimestamps)
            ? pathTimestamps
            : [pathTimestamps],
    }
  }
  if (
    isRecord(input) &&
    "coordinates" in input &&
    Array.isArray(input.coordinates)
  ) {
    return {
      paths: [input.coordinates],
      timestamps:
        !("pointTimestamps" in input) || input.pointTimestamps === undefined
          ? undefined
          : [input.pointTimestamps],
    }
  }
  return { paths: [], timestamps: undefined }
}

function appendOutputPoint(
  output: OutputPoint[],
  point: OutputPoint,
  duplicateToleranceMeters: number,
  warning: () => void
) {
  const previous = output[output.length - 1]
  if (
    previous &&
    haversineMeters(previous.coordinate, point.coordinate) <=
      duplicateToleranceMeters
  ) {
    warning()
    return
  }
  output.push(point)
}

function splitAtAntimeridian(
  points: InputPoint[],
  pathIndex: number,
  options: Required<FogInputOptions>,
  warningCollector: WarningCollector
): OutputPoint[][] {
  if (points.length < 2) return []
  const result: OutputPoint[][] = []
  let current: OutputPoint[] = []
  const flush = () => {
    if (current.length >= 2) result.push(current)
    current = []
  }
  const push = (point: OutputPoint, pointIndex: number) => {
    appendOutputPoint(current, point, options.duplicateToleranceMeters, () => {
      addWarning(warningCollector, {
        code: "coalesced_duplicate_point",
        message:
          "A consecutive duplicate or near-duplicate point was coalesced.",
        pathIndex,
        pointIndex,
      })
    })
  }

  const warnSeam = (pointIndex: number, message: string) => {
    addWarning(warningCollector, {
      code: "split_antimeridian",
      message,
      pathIndex,
      pointIndex,
    })
  }

  const firstDirection =
    points[1].unwrappedLng === points[0].unwrappedLng
      ? 0
      : points[1].unwrappedLng - points[0].unwrappedLng
  current.push({
    coordinate: [
      boundaryLongitudeForPoint(points[0], firstDirection),
      points[0].lat,
    ],
    timestamp: points[0].timestamp,
  })

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    const delta = to.unwrappedLng - from.unwrappedLng
    if (delta === 0) {
      const previousLongitude = current[current.length - 1]?.coordinate[0]
      push(
        {
          coordinate: [
            isBoundary(to.lng) &&
            previousLongitude !== undefined &&
            isBoundary(previousLongitude)
              ? previousLongitude
              : to.lng,
            to.lat,
          ],
          timestamp: to.timestamp,
        },
        index
      )
      continue
    }

    // A vertex exactly on the seam needs the side selected by the outgoing
    // direction.  Otherwise [180,-179] becomes a false 359° edge.
    if (
      isBoundary(from.lng) &&
      current.length > 0 &&
      current[current.length - 1].coordinate[0] !==
        boundaryLongitudeForPoint(from, delta)
    ) {
      warnSeam(index - 1, "A route at the antimeridian was split at the seam.")
      flush()
      current.push({
        coordinate: [boundaryLongitudeForPoint(from, delta), from.lat],
        timestamp: from.timestamp,
      })
    }

    const startBand = Math.floor((from.unwrappedLng + 180) / 360)
    const endBand = Math.floor((to.unwrappedLng + 180) / 360)
    const step = endBand > startBand ? 1 : -1
    let band = startBand
    while (band !== endBand) {
      const boundary = ((band + (step > 0 ? 1 : 0)) * 360 - 180) as number
      const fraction = (boundary - from.unwrappedLng) / delta
      const latitude = from.lat + (to.lat - from.lat) * fraction
      const timestamp = interpolateTimestamp(
        from.timestamp,
        to.timestamp,
        fraction
      )
      push(
        {
          coordinate: [delta > 0 ? 180 : -180, latitude],
          timestamp,
        },
        index
      )
      flush()
      current.push({
        coordinate: [delta > 0 ? -180 : 180, latitude],
        timestamp,
      })
      warnSeam(
        index,
        "A route crossing the antimeridian was split at the seam."
      )
      band += step
    }

    push(
      {
        coordinate: [
          isBoundary(to.lng) ? (delta > 0 ? 180 : -180) : to.lng,
          to.lat,
        ],
        timestamp: to.timestamp,
      },
      index
    )
  }
  flush()
  return result
}

/**
 * Sanitize one legacy or canonical activity for the fog engine.
 *
 * Invalid points and implausible jumps terminate only the current sub-path.
 * Source paths are processed independently, so no operation in this module
 * can connect the end of one GPX segment to the start of another.
 */
export function sanitizeFogInput(
  input: FogGeometryInput,
  suppliedOptions: FogInputOptions = {}
): FogInputResult {
  const options: Required<FogInputOptions> = {
    ...FOG_INPUT_DEFAULTS,
    ...suppliedOptions,
  }
  const geometry = readGeometry(input)
  const warningCollector: WarningCollector = {
    examples: [],
    counts: {},
  }
  const outputPaths: ActivityPaths = []
  const outputTimestamps: ActivityPathTimestamps[] = []
  let inputPointCount = 0
  let hasTimestamps = geometry.timestamps !== undefined

  for (let pathIndex = 0; pathIndex < geometry.paths.length; pathIndex += 1) {
    const rawPath = geometry.paths[pathIndex]
    if (!Array.isArray(rawPath)) {
      addWarning(warningCollector, {
        code: "dropped_path",
        message: "A non-array activity path was dropped.",
        pathIndex,
      })
      continue
    }
    inputPointCount += rawPath.length
    const rawTimestamps = geometry.timestamps?.[pathIndex]
    if (rawTimestamps !== undefined && !Array.isArray(rawTimestamps)) {
      return makeResult(
        outputPaths,
        hasTimestamps ? outputTimestamps : undefined,
        warningCollector,
        inputPointCount,
        "invalid_timestamps"
      )
    }
    if (
      rawTimestamps !== undefined &&
      rawTimestamps.length !== rawPath.length
    ) {
      return makeResult(
        outputPaths,
        hasTimestamps ? outputTimestamps : undefined,
        warningCollector,
        inputPointCount,
        "invalid_timestamps"
      )
    }
    if (rawTimestamps === undefined && hasTimestamps) {
      return makeResult(
        outputPaths,
        outputTimestamps,
        warningCollector,
        inputPointCount,
        "invalid_timestamps"
      )
    }

    let previous: InputPoint | undefined
    let current: InputPoint[] = []
    const flush = () => {
      if (current.length < 2) {
        if (current.length === 1) {
          addWarning(warningCollector, {
            code: "dropped_path",
            message: "A path with fewer than two usable points was dropped.",
            pathIndex,
          })
        }
        current = []
        previous = undefined
        return
      }
      const splitPaths = splitAtAntimeridian(
        current,
        pathIndex,
        options,
        warningCollector
      )
      for (const splitPath of splitPaths) {
        const simplified = simplifyPath(
          splitPath,
          options.activitySimplifyToleranceDegrees
        )
        const reduced = reduceToBudget(simplified, options.maxPointsPerPath)
        if (reduced.reduced) {
          addWarning(warningCollector, {
            code: "point_budget_exceeded",
            message:
              "A path exceeded the technical point budget and was reduced deterministically.",
            pathIndex,
          })
        }
        if (reduced.points.length < 2) continue
        outputPaths.push(reduced.points.map((point) => point.coordinate))
        if (hasTimestamps) {
          outputTimestamps.push(
            reduced.points.map((point) => point.timestamp ?? null)
          )
        }
      }
      current = []
      previous = undefined
    }

    for (let pointIndex = 0; pointIndex < rawPath.length; pointIndex += 1) {
      const rawPoint: unknown = rawPath[pointIndex]
      if (!isCoordinate(rawPoint) || rawPoint[1] < -90 || rawPoint[1] > 90) {
        addWarning(warningCollector, {
          code: "dropped_invalid_point",
          message: "A non-finite or out-of-range WGS84 point split the path.",
          pathIndex,
          pointIndex,
        })
        flush()
        continue
      }

      const rawTimestamp = rawTimestamps?.[pointIndex]
      if (
        rawTimestamp !== undefined &&
        rawTimestamp !== null &&
        (!isFiniteNumber(rawTimestamp) || rawTimestamp < 0)
      ) {
        // -1 is the legacy parser's missing-time sentinel.
        if (rawTimestamp !== -1) {
          return makeResult(
            outputPaths,
            hasTimestamps ? outputTimestamps : undefined,
            warningCollector,
            inputPointCount,
            "invalid_timestamps"
          )
        }
      }
      const timestamp: Timestamp | undefined =
        rawTimestamp === -1 ? null : (rawTimestamp as Timestamp | undefined)
      const latitude = Math.max(
        -options.maxLatitude,
        Math.min(options.maxLatitude, rawPoint[1])
      )
      if (latitude !== rawPoint[1]) {
        addWarning(warningCollector, {
          code: "clamped_latitude",
          message:
            "A pole-adjacent point was clamped to the map projection limit.",
          pathIndex,
          pointIndex,
        })
      }
      const longitude = wrapLongitude(rawPoint[0])
      const unwrappedLng = previous
        ? previous.unwrappedLng +
          shortestLongitudeDelta(previous.lng, longitude)
        : longitude
      const point: InputPoint = {
        lng: longitude,
        unwrappedLng,
        lat: latitude,
        timestamp,
      }

      const crossesAntimeridian =
        previous &&
        Math.floor((previous.unwrappedLng + 180) / 360) !==
          Math.floor((point.unwrappedLng + 180) / 360)
      if (
        previous &&
        !crossesAntimeridian &&
        haversineMeters([previous.lng, previous.lat], [point.lng, point.lat]) >
          options.teleportThresholdMeters
      ) {
        addWarning(warningCollector, {
          code: "split_teleport",
          message:
            "An implausibly long GPS jump split the path before buffering.",
          pathIndex,
          pointIndex,
        })
        flush()
      }

      if (previous && current.length > 0) {
        const distance = haversineMeters(
          [previous.lng, previous.lat],
          [point.lng, point.lat]
        )
        if (distance <= options.duplicateToleranceMeters) {
          addWarning(warningCollector, {
            code: "coalesced_duplicate_point",
            message:
              "A consecutive duplicate or near-duplicate point was coalesced.",
            pathIndex,
            pointIndex,
          })
          continue
        }
      }
      current.push(point)
      previous = point
    }
    flush()
  }

  if (outputPaths.length === 0) {
    return makeResult(
      outputPaths,
      hasTimestamps ? outputTimestamps : undefined,
      warningCollector,
      inputPointCount,
      "no_usable_paths"
    )
  }
  if (outputPaths.some((path) => path.length > options.maxPointsPerPath)) {
    return makeResult(
      outputPaths,
      hasTimestamps ? outputTimestamps : undefined,
      warningCollector,
      inputPointCount,
      "point_budget_exceeded"
    )
  }
  const outputPointCount = outputPaths.reduce(
    (total, path) => total + path.length,
    0
  )
  if (outputPointCount > options.maxTotalPoints) {
    addWarning(warningCollector, {
      code: "point_budget_exceeded",
      message:
        "The activity exceeded the total technical point budget and was rejected.",
      pathIndex: -1,
    })
    return makeResult(
      outputPaths,
      hasTimestamps ? outputTimestamps : undefined,
      warningCollector,
      inputPointCount,
      "point_budget_exceeded"
    )
  }
  return makeResult(
    outputPaths,
    hasTimestamps ? outputTimestamps : undefined,
    warningCollector,
    inputPointCount
  )
}

/** Alias emphasizing that this function accepts either geometry contract. */
export const sanitizeFogGeometry = sanitizeFogInput

/** Alias for callers that already have a full activity object. */
export const sanitizeFogActivity = sanitizeFogInput
