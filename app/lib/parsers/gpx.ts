import { gpx } from "@tmcw/togeojson"
import type { ActivityCoords, ActivityPathTimestamps } from "~/types/activities"
import { computeActivityStatsForPaths } from "~/lib/stats"
import { normalizeActivityType } from "~/lib/activityType"
import { deriveStartSunPhase } from "~/lib/sunPhase"
import { createUuid } from "~/lib/uuid"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
} from "~/lib/activities/gpsAnomalies"
import { buildGpsAnomalyReport } from "~/lib/activities/gpsAnomalyDebug"
import type {
  ParsedImportActivity,
  ParsedImportParseResult,
  ParsedImportRejection,
} from "./types"

function buildRawPoints(
  coords: [number, number, number?][],
  times?: string[]
): AnomalyPoint[] {
  return coords.map((c, sourcePointIndex) => ({
    lng: c[0],
    lat: c[1],
    sourcePointIndex,
    elevationM: c[2] != null && Number.isFinite(c[2]) ? c[2] : undefined,
    timestampMs: (() => {
      if (!times?.[sourcePointIndex]) return undefined
      const timestamp = Date.parse(times[sourcePointIndex]!)
      return Number.isFinite(timestamp) ? timestamp : undefined
    })(),
  }))
}

function stringTimes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((time) => String(time))
}

interface GpxActivityBuildResult {
  activity?: ParsedImportActivity
  rejection?: ParsedImportRejection
}

function buildParsedActivity(
  file: File,
  paths: ActivityCoords[],
  pathTimestamps: (string[] | undefined)[],
  activityType: ParsedImportActivity["activityType"]
): GpxActivityBuildResult {
  const id = createUuid()
  if (paths.length === 0) {
    return {
      rejection: { id, reason: "no-renderable-path" },
    }
  }

  const sourcePaths: AnomalySourcePath[] = paths.map((path, index) => ({
    sourcePathIndex: index,
    points: buildRawPoints(
      path as [number, number, number?][],
      pathTimestamps[index]
    ),
  }))
  const detectorStartedAt = performance.now()
  const anomaly = detectGpsAnomalies(sourcePaths, { activityType })
  const detectorDurationMs = performance.now() - detectorStartedAt
  const rejectionReport =
    anomaly.status === "ambiguous" || anomaly.status === "rejected"
      ? buildGpsAnomalyReport({
          result: anomaly,
          format: "gpx",
          activityType,
          sourcePaths,
          afterStats: null,
          detectorDurationMs,
        })
      : undefined
  if (rejectionReport) {
    return {
      rejection: {
        id,
        reason:
          anomaly.status === "ambiguous"
            ? "ambiguous-gps-discontinuity"
            : "no-renderable-path",
        gpsAnomalyReport: rejectionReport,
      },
    }
  }

  const canonicalPaths = anomaly.paths.map((path) =>
    path.map(({ lng, lat }) => [lng, lat] as [number, number])
  ) as ActivityCoords[]
  if (canonicalPaths.length === 0) {
    return {
      rejection: {
        id,
        reason: "no-renderable-path",
        ...(rejectionReport ? { gpsAnomalyReport: rejectionReport } : {}),
      },
    }
  }

  const timestamps = anomaly.paths.map((path) =>
    path.map((point) => point.timestampMs ?? null)
  )
  const hasTimestamp = timestamps.some((path) =>
    path.some((timestamp) => timestamp != null)
  )
  const retainedPoints = anomaly.paths.flat()
  const firstDatedPoint = retainedPoints.find(
    (point) => point.timestampMs != null && Number.isFinite(point.timestampMs)
  )
  const startedAtMs = firstDatedPoint?.timestampMs ?? null
  const coordinates = canonicalPaths.flatMap((path) => path) as ActivityCoords
  const stats = computeActivityStatsForPaths(anomaly.paths)
  const afterStats = { ...stats, uniqueDistanceKm: stats.distanceKm }
  const completedReport =
    anomaly.status === "cleaned"
      ? buildGpsAnomalyReport({
          result: anomaly,
          format: "gpx",
          activityType,
          sourcePaths,
          afterStats,
          detectorDurationMs,
        })
      : undefined
  const canonicalTimestamps = hasTimestamp
    ? (timestamps as ActivityPathTimestamps[])
    : undefined
  return {
    activity: {
      id,
      name: file.name,
      startedAtMs,
      coordinates,
      paths: canonicalPaths,
      ...(canonicalTimestamps ? { pathTimestamps: canonicalTimestamps } : {}),
      ...(hasTimestamp
        ? {
            pointTimestamps: timestamps.flatMap((path) =>
              path.map((timestamp) => timestamp ?? -1)
            ),
          }
        : {}),
      startSunPhase: deriveStartSunPhase(
        firstDatedPoint ? [[firstDatedPoint.lng, firstDatedPoint.lat]] : [],
        startedAtMs
      ),
      format: "gpx",
      ...(activityType ? { activityType } : {}),
      stats: afterStats,
      ...(completedReport ? { gpsAnomalyReport: completedReport } : {}),
    },
  }
}

/**
 * Parse one GPX file into one activity per track or route. A MultiLineString
 * remains one activity with disconnected paths; callers must not connect its
 * endpoints by flattening it into one LineString.
 */
export async function parseGpxFileWithResults(
  file: File
): Promise<ParsedImportParseResult> {
  const text = await file.text()
  const dom = new DOMParser().parseFromString(text, "text/xml")
  const geo = gpx(dom)

  const activities: ParsedImportActivity[] = []
  const rejections: ParsedImportRejection[] = []
  const addResult = (result: GpxActivityBuildResult, activityIndex: number) => {
    if (result.activity) activities.push(result.activity)
    if (result.rejection) {
      rejections.push({ ...result.rejection, activityIndex })
    }
  }
  for (const [activityIndex, feat] of geo.features.entries()) {
    if (!feat.geometry) continue
    const activityType = normalizeActivityType(feat.properties?.type)
    if (feat.geometry.type === "LineString") {
      const paths = [feat.geometry.coordinates as ActivityCoords]
      const times = [stringTimes(feat.properties?.coordinateProperties?.times)]
      addResult(
        buildParsedActivity(file, paths, times, activityType),
        activityIndex
      )
      continue
    }
    if (feat.geometry.type === "MultiLineString") {
      const paths = feat.geometry.coordinates as ActivityCoords[]
      const rawTimes = feat.properties?.coordinateProperties?.times
      const times = Array.isArray(rawTimes)
        ? rawTimes.map((value) => stringTimes(value))
        : paths.map(() => undefined)
      addResult(
        buildParsedActivity(file, paths, times, activityType),
        activityIndex
      )
    }
  }
  return { activities, rejections }
}

export async function parseGpxFile(
  file: File
): Promise<ParsedImportActivity[]> {
  return (await parseGpxFileWithResults(file)).activities
}
