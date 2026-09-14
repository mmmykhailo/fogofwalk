import FitParser from "fit-file-parser"
import type {
  RawPoint,
  ActivityLap,
  ActivityLapPathRange,
} from "~/types/activities"
import { computeActivityStatsForPaths } from "~/lib/stats"
import { LAP_PROFILE_POINTS, MAX_LAPS } from "~/constants/fog"
import { normalizeActivityType } from "~/lib/activityType"
import { deriveStartSunPhase } from "~/lib/sunPhase"
import { createUuid } from "~/lib/uuid"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
} from "~/lib/activities/gpsAnomalies"
import { buildGpsAnomalyReport } from "~/lib/activities/gpsAnomalyDebug"
import type {
  ParsedImportActivity,
  ParsedImportParseResult,
  ParsedImportRejection,
} from "./types"

/**
 * `fit-file-parser` decodes every FIT `date_time` field into a `Date` object
 * (dist/binary.js formatByType), even though its bundled .d.ts declares those
 * fields as `string`. `Date.parse(dateObject)` coerces through `toString()` and
 * silently drops milliseconds, so lap boundaries and record timestamps must go
 * through this one helper or they end up on different time bases and every lap
 * boundary lands a point early or late.
 *
 * Exported only so the lap-splitting logic stays verifiable without a real FIT
 * file; `parseFitFile` is the only production caller.
 */
export function fitTimeToMs(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  return NaN
}

interface LapBoundary {
  number: number
  startMs: number
  trigger?: string
  totalElapsedTimeS?: number
}

/**
 * Splits already-filtered `rawPoints` into laps using the FIT lap messages.
 *
 * Each lap is bounded by the *next* lap's `start_time` rather than its own
 * `timestamp` (which is the lap end and is inclusive, so it double-counts
 * boundary points and leaves auto-pause gaps belonging to no lap). Sweeping
 * forward once with a non-decreasing lap index makes the resulting ranges
 * contiguous, non-overlapping and exhaustive by construction. The lap sweep
 * stays active across retained paths, while range state resets at every path
 * boundary so a removed anomaly gap is never bridged.
 *
 * Returns `undefined` when there is nothing worth showing a selector for.
 *
 * Exported for the same reason as `fitTimeToMs`; `parseFitFile` is the only
 * production caller.
 */
export function buildLapsFromFit(
  rawInput: RawPoint[] | RawPoint[][],
  fitLaps: unknown[]
): ActivityLap[] | undefined {
  const rawPaths: RawPoint[][] =
    rawInput.length > 0 && Array.isArray(rawInput[0])
      ? (rawInput as RawPoint[][])
      : [rawInput as RawPoint[]]
  const totalPointCount = rawPaths.reduce(
    (total, path) => total + path.length,
    0
  )
  if (totalPointCount < 2 || fitLaps.length < 2) return undefined
  if (fitLaps.length > MAX_LAPS) return undefined

  // Lap number comes from the position in the FIT lap array, which devices
  // write chronologically — so it is the number the watch showed. The sort
  // below is only a safety net; note it does NOT renumber, so a hypothetical
  // out-of-order file keeps each lap's original label. (`message_index` looks
  // like the canonical answer but the library decodes it through an enum map,
  // where e.g. 4095 becomes the string 'mask'.)
  const boundaries: LapBoundary[] = []
  fitLaps.forEach((raw, i) => {
    const lap = raw as Record<string, unknown>
    const startMs = fitTimeToMs(lap.start_time)
    if (!isFinite(startMs)) return
    const elapsed = lap.total_elapsed_time
    boundaries.push({
      number: i + 1,
      startMs,
      trigger:
        typeof lap.lap_trigger === "string" ? lap.lap_trigger : undefined,
      totalElapsedTimeS: typeof elapsed === "number" ? elapsed : undefined,
    })
  })
  if (boundaries.length < 2) return undefined
  boundaries.sort((a, b) => a.startMs - b.startMs)

  const rangesByLap = boundaries.map(() => [] as ActivityLapPathRange[])
  let lapIdx = 0
  for (let pathIndex = 0; pathIndex < rawPaths.length; pathIndex += 1) {
    const rawPoints = rawPaths[pathIndex]!
    let startIndex = -1
    let activeLap = -1
    const flush = (endIndex: number) => {
      if (activeLap === -1 || startIndex === -1) return
      rangesByLap[activeLap]!.push({ pathIndex, startIndex, endIndex })
      startIndex = -1
    }
    for (let pointIndex = 0; pointIndex < rawPoints.length; pointIndex += 1) {
      const timestamp = rawPoints[pointIndex]!.timestampMs
      if (timestamp != null) {
        while (
          lapIdx + 1 < boundaries.length &&
          timestamp >= boundaries[lapIdx + 1]!.startMs
        ) {
          lapIdx += 1
        }
      }
      if (activeLap !== lapIdx) {
        flush(pointIndex - 1)
        activeLap = lapIdx
        startIndex = pointIndex
      }
    }
    flush(rawPoints.length - 1)
  }

  const laps: ActivityLap[] = []
  let previousRanges: ActivityLapPathRange[] = []
  for (let k = 0; k < boundaries.length; k += 1) {
    const ranges = rangesByLap[k]!
    if (ranges.length === 0) continue

    // Adjacent laps share a boundary point only when the ranges touch inside
    // the same retained path. A removed anomaly gap has no such adjacency.
    for (const range of ranges) {
      const previous = previousRanges.find(
        (candidate) =>
          candidate.pathIndex === range.pathIndex &&
          candidate.endIndex + 1 === range.startIndex
      )
      if (previous) range.startIndex = previous.endIndex
    }

    const renderableRanges = ranges.filter(
      (range) => range.endIndex - range.startIndex >= 1
    )
    const slices = renderableRanges.map((range) =>
      rawPaths[range.pathIndex]!.slice(range.startIndex, range.endIndex + 1)
    )
    const pointCount = slices.reduce((total, slice) => total + slice.length, 0)
    if (pointCount < 2 || renderableRanges.length === 0) {
      continue
    }
    const stats = computeActivityStatsForPaths(slices, LAP_PROFILE_POINTS)

    // The shared boundary point means durationMs would also count the gap
    // bridging into this lap — minutes if the user pressed lap while standing
    // still. The device's own total_elapsed_time is both correct and what the
    // watch and Strava display, so prefer it when present.
    const elapsedMs =
      boundaries[k].totalElapsedTimeS != null &&
      isFinite(boundaries[k].totalElapsedTimeS as number)
        ? (boundaries[k].totalElapsedTimeS as number) * 1000
        : null
    const durationMs =
      ranges.length > 1 ? stats.durationMs : (elapsedMs ?? stats.durationMs)
    const avgPaceMinPerKm =
      durationMs != null && durationMs > 0 && stats.distanceKm > 0
        ? durationMs / 60_000 / stats.distanceKm
        : null
    const avgSpeedKmh =
      durationMs != null && durationMs > 0 && stats.distanceKm > 0
        ? stats.distanceKm / (durationMs / 3_600_000)
        : null

    const firstSlice = slices[0]!
    const startTs = firstSlice.find(
      (point) => point.timestampMs != null && isFinite(point.timestampMs)
    )?.timestampMs
    const firstRange = renderableRanges[0]!
    laps.push({
      number: boundaries[k].number,
      startIndex: firstRange.startIndex,
      endIndex: firstRange.endIndex,
      pathRanges: renderableRanges,
      startedAtMs: startTs != null && isFinite(startTs) ? startTs : null,
      trigger: boundaries[k].trigger,
      stats: {
        ...stats,
        durationMs,
        avgPaceMinPerKm,
        avgSpeedKmh,
        // Unique distance is a library-wide grid computation that would shift
        // whenever an unrelated activity is imported. Not meaningful per lap.
        uniqueDistanceKm: 0,
      },
    })
    previousRanges = ranges
  }

  // One lap spanning the whole activity is what every FIT has; a selector with
  // a single entry identical to "All" is noise.
  return laps.length >= 2 ? laps : undefined
}

export async function parseFitFileWithResults(
  file: File
): Promise<ParsedImportParseResult> {
  const buffer = await file.arrayBuffer()
  const parser = new FitParser({ force: true, speedUnit: "m/s" })
  const data = await parser.parseAsync(buffer)

  // fit-file-parser already returns position_lat/long in degrees
  const validRecords = (data.records ?? []).filter((r) => {
    const lat = r.position_lat
    const lng = r.position_long
    if (lat == null || lng == null) return false
    // Drop pre-GPS-lock records clustered near null island
    if (Math.abs(lat as number) < 0.001 && Math.abs(lng as number) < 0.001)
      return false
    return true
  })

  if (validRecords.length < 2) {
    return {
      activities: [],
      rejections: [
        { id: createUuid(), reason: "no-renderable-path", activityIndex: 0 },
      ],
    }
  }

  const activityType = normalizeActivityType(
    data.sessions?.[0]?.sport ?? data.sports?.[0]?.sport
  )
  const rawPoints: AnomalyPoint[] = validRecords.map((r, sourcePointIndex) => {
    const alt = r.enhanced_altitude ?? r.altitude
    const ts = fitTimeToMs(r.timestamp)
    const recordedSpeed = r.enhanced_speed ?? r.speed
    return {
      sourcePointIndex,
      lng: r.position_long as number,
      lat: r.position_lat as number,
      elevationM: typeof alt === "number" && isFinite(alt) ? alt : undefined,
      timestampMs: isFinite(ts) ? ts : undefined,
      ...(typeof recordedSpeed === "number" && isFinite(recordedSpeed)
        ? { recordedSpeedMps: recordedSpeed }
        : {}),
      ...(typeof r.gps_accuracy === "number" && isFinite(r.gps_accuracy)
        ? { gpsAccuracyM: r.gps_accuracy }
        : {}),
    }
  })

  const detectorStartedAt = performance.now()
  const anomaly = detectGpsAnomalies(
    [{ sourcePathIndex: 0, points: rawPoints }],
    { activityType }
  )
  const detectorDurationMs = performance.now() - detectorStartedAt
  const sourcePaths = [{ sourcePathIndex: 0, points: rawPoints }]
  const rejectionReport =
    anomaly.status === "ambiguous" || anomaly.status === "rejected"
      ? buildGpsAnomalyReport({
          result: anomaly,
          format: "fit",
          activityType,
          sourcePaths,
          afterStats: null,
          detectorDurationMs,
        })
      : undefined
  if (rejectionReport) {
    const rejection: ParsedImportRejection = {
      id: createUuid(),
      activityIndex: 0,
      reason:
        anomaly.status === "ambiguous"
          ? "ambiguous-gps-discontinuity"
          : "no-renderable-path",
      gpsAnomalyReport: rejectionReport,
    }
    return { activities: [], rejections: [rejection] }
  }

  const retainedPaths = anomaly.paths
  const coords = retainedPaths.flatMap((path) =>
    path.map((point) => [point.lng, point.lat] as [number, number])
  )
  const timestamps = retainedPaths.map((path) =>
    path.map((point) => point.timestampMs ?? null)
  )

  const firstDatedPoint = retainedPaths
    .flat()
    .find((point) => point.timestampMs != null && isFinite(point.timestampMs))
  const startedAtMs = firstDatedPoint?.timestampMs ?? null
  const stats = computeActivityStatsForPaths(retainedPaths)
  const afterStats = { ...stats, uniqueDistanceKm: stats.distanceKm }
  const completedReport =
    anomaly.status === "cleaned"
      ? buildGpsAnomalyReport({
          result: anomaly,
          format: "fit",
          activityType,
          sourcePaths,
          afterStats,
          detectorDurationMs,
        })
      : undefined
  const laps = buildLapsFromFit(retainedPaths, data.laps ?? [])
  return {
    activities: [
      {
        id: createUuid(),
        name: file.name,
        startedAtMs,
        coordinates: coords,
        paths: retainedPaths.map((path) =>
          path.map((point) => [point.lng, point.lat] as [number, number])
        ),
        ...(timestamps.some((path) =>
          path.some((timestamp) => timestamp != null)
        )
          ? { pathTimestamps: timestamps }
          : {}),
        startSunPhase: deriveStartSunPhase(
          firstDatedPoint ? [[firstDatedPoint.lng, firstDatedPoint.lat]] : [],
          startedAtMs
        ),
        pointTimestamps: timestamps.every((path) =>
          path.every((timestamp) => timestamp == null)
        )
          ? undefined
          : timestamps.flatMap((path) => path.map((t) => t ?? -1)),
        format: "fit",
        ...(activityType ? { activityType } : {}),
        stats: afterStats,
        ...(laps ? { laps } : {}),
        ...(completedReport ? { gpsAnomalyReport: completedReport } : {}),
      },
    ],
    rejections: [],
  }
}

export async function parseFitFile(
  file: File
): Promise<ParsedImportActivity[]> {
  return (await parseFitFileWithResults(file)).activities
}
