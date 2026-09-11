import { gpx } from "@tmcw/togeojson"
import type {
  ParsedActivity,
  RawPoint,
  ActivityCoords,
  ActivityPaths,
  ActivityPathTimestamps,
} from "~/types/activities"
import { computeActivityStatsForPaths } from "~/lib/stats"
import { normalizeActivityType } from "~/lib/activityType"
import { deriveStartSunPhase } from "~/lib/sunPhase"
import { createUuid } from "~/lib/uuid"

function buildRawPoints(
  coords: [number, number, number?][],
  times?: string[]
): RawPoint[] {
  return coords.map((c, i) => ({
    lng: c[0],
    lat: c[1],
    elevationM: c[2] != null && isFinite(c[2]) ? c[2] : undefined,
    timestampMs: (() => {
      if (!times?.[i]) return undefined
      const timestamp = Date.parse(times[i]!)
      return Number.isFinite(timestamp) ? timestamp : undefined
    })(),
  }))
}

function stringTimes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((time) => String(time))
}

function usablePointSegments(points: RawPoint[]): RawPoint[][] {
  const segments: RawPoint[][] = []
  let current: RawPoint[] = []
  const flush = () => {
    if (current.length >= 2) segments.push(current)
    current = []
  }
  for (const point of points) {
    if (
      !Number.isFinite(point.lng) ||
      !Number.isFinite(point.lat) ||
      point.lat < -90 ||
      point.lat > 90 ||
      point.lng < -180 ||
      point.lng > 180
    ) {
      flush()
      continue
    }
    current.push(point)
  }
  flush()
  return segments
}

function buildParsedActivity(
  file: File,
  paths: ActivityCoords[],
  pathTimestamps: (string[] | undefined)[],
  activityType: ParsedActivity["activityType"]
): ParsedActivity | null {
  if (paths.length === 0) return null

  const rawPaths = paths.map((path, index) =>
    buildRawPoints(path as [number, number, number?][], pathTimestamps[index])
  )
  const usableSegments = rawPaths.flatMap(usablePointSegments)
  const allPoints = usableSegments.flat()
  if (allPoints.length === 0) return null

  const timestamps = rawPaths.map((path) =>
    path.map((point) => point.timestampMs ?? null)
  )
  const hasTimestamp = timestamps.some((path) =>
    path.some((timestamp) => timestamp != null)
  )
  const validTimestamps = allPoints
    .map((point) => point.timestampMs)
    .filter(
      (timestamp): timestamp is number =>
        timestamp != null && isFinite(timestamp)
    )
  // togeojson keeps GPX elevation as a third coordinate ordinate. The
  // canonical activity geometry is deliberately two-dimensional; elevation is
  // already captured in the raw stats above. Strip the ordinate before the
  // draft reaches normalizeActivityGeometry, which rejects non-2D points.
  const canonicalPaths = paths.map(
    (path) =>
      path.map(([lng, lat]) => [lng, lat] as [number, number]) as ActivityCoords
  )
  const coordinates = canonicalPaths.flatMap((path) => path) as ActivityCoords
  const stats = computeActivityStatsForPaths(usableSegments)
  const canonicalTimestamps = hasTimestamp
    ? timestamps.map((path) => path as ActivityPathTimestamps)
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
  }
}

/**
 * Parse one GPX file into one activity per track or route. A MultiLineString
 * remains one activity with disconnected paths; callers must not connect its
 * endpoints by flattening it into one LineString.
 */
export async function parseGpxFile(file: File): Promise<ParsedActivity[]> {
  const text = await file.text()
  const dom = new DOMParser().parseFromString(text, "text/xml")
  const geo = gpx(dom)

  const activities: ParsedActivity[] = []
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
