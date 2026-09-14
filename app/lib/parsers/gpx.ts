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
import type { ParsedImportActivity } from "./types"

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

function buildParsedActivity(
  file: File,
  paths: ActivityCoords[],
  pathTimestamps: (string[] | undefined)[],
  activityType: ParsedImportActivity["activityType"]
): ParsedImportActivity | null {
  if (paths.length === 0) return null

  const sourcePaths: AnomalySourcePath[] = paths.map((path, index) => ({
    sourcePathIndex: index,
    points: buildRawPoints(
      path as [number, number, number?][],
      pathTimestamps[index]
    ),
  }))
  const anomaly = detectGpsAnomalies(sourcePaths, { activityType })
  if (anomaly.status === "ambiguous" || anomaly.status === "rejected") {
    return null
  }

  const canonicalPaths = anomaly.paths.map((path) =>
    path.map(({ lng, lat }) => [lng, lat] as [number, number])
  ) as ActivityCoords[]
  if (canonicalPaths.length === 0) return null

  const timestamps = anomaly.paths.map((path) =>
    path.map((point) => point.timestampMs ?? null)
  )
  const hasTimestamp = timestamps.some((path) =>
    path.some((timestamp) => timestamp != null)
  )
  const retainedPoints = anomaly.paths.flat()
  const validTimestamps = retainedPoints
    .map((point) => point.timestampMs)
    .filter(
      (timestamp): timestamp is number =>
        timestamp != null && Number.isFinite(timestamp)
    )
  const coordinates = canonicalPaths.flatMap((path) => path) as ActivityCoords
  const stats = computeActivityStatsForPaths(anomaly.paths)
  const canonicalTimestamps = hasTimestamp
    ? (timestamps as ActivityPathTimestamps[])
    : undefined
  return {
    id: createUuid(),
    name: file.name,
    startedAtMs: validTimestamps[0] ?? null,
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
    startSunPhase: deriveStartSunPhase(coordinates, validTimestamps[0] ?? null),
    format: "gpx",
    ...(activityType ? { activityType } : {}),
    stats: { ...stats, uniqueDistanceKm: stats.distanceKm },
    ...(anomaly.status !== "clean"
      ? {
          gpsAnomalyReport: {
            status: anomaly.status,
            counts: anomaly.counts,
            examples: anomaly.examples,
            work: anomaly.work,
          },
        }
      : {}),
  }
}

/**
 * Parse one GPX file into one activity per track or route. A MultiLineString
 * remains one activity with disconnected paths; callers must not connect its
 * endpoints by flattening it into one LineString.
 */
export async function parseGpxFile(
  file: File
): Promise<ParsedImportActivity[]> {
  const text = await file.text()
  const dom = new DOMParser().parseFromString(text, "text/xml")
  const geo = gpx(dom)

  const activities: ParsedImportActivity[] = []
  for (const feat of geo.features) {
    if (!feat.geometry) continue
    const activityType = normalizeActivityType(feat.properties?.type)
    if (feat.geometry.type === "LineString") {
      const paths = [feat.geometry.coordinates as ActivityCoords]
      const times = [stringTimes(feat.properties?.coordinateProperties?.times)]
      const parsed = buildParsedActivity(file, paths, times, activityType)
      if (parsed) activities.push(parsed)
      continue
    }
    if (feat.geometry.type === "MultiLineString") {
      const paths = feat.geometry.coordinates as ActivityCoords[]
      const rawTimes = feat.properties?.coordinateProperties?.times
      const times = Array.isArray(rawTimes)
        ? rawTimes.map((value) => stringTimes(value))
        : paths.map(() => undefined)
      const parsed = buildParsedActivity(file, paths, times, activityType)
      if (parsed) activities.push(parsed)
    }
  }
  return activities
}
