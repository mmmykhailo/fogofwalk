import { gpx } from "@tmcw/togeojson"
import type {
  ParsedActivity,
  RawPoint,
  ActivityCoords,
} from "~/types/activities"
import { computeActivityStats } from "~/lib/stats"
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
    timestampMs: times?.[i] ? Date.parse(times[i]) || undefined : undefined,
  }))
}

export async function parseGpxFile(file: File): Promise<ParsedActivity[]> {
  const text = await file.text()
  const dom = new DOMParser().parseFromString(text, "text/xml")
  const geo = gpx(dom)

  const activities: ParsedActivity[] = []
  for (const feat of geo.features) {
    if (!feat.geometry) continue
    const activityType = normalizeActivityType(feat.properties?.type)
    if (feat.geometry.type === "LineString") {
      const rawCoords = feat.geometry.coordinates as [number, number, number?][]
      if (rawCoords.length > 1) {
        const times: string[] | undefined =
          feat.properties?.coordinateProperties?.times
        const rawPoints = buildRawPoints(rawCoords, times)
        const ts = rawPoints.map((p) => p.timestampMs)
        const validTs = ts.filter((t): t is number => t != null && isFinite(t))
        const stats = computeActivityStats(rawPoints)
        const coordinates = rawCoords.map((c) => [c[0], c[1]]) as ActivityCoords
        const startedAtMs = validTs.length > 0 ? validTs[0] : null
        activities.push({
          id: createUuid(),
          name: file.name,
          startedAtMs,
          coordinates,
          startSunPhase: deriveStartSunPhase(coordinates, startedAtMs),
          pointTimestamps: ts.every((t) => t == null)
            ? undefined
            : ts.map((t) => t ?? -1),
          format: "gpx",
          ...(activityType ? { activityType } : {}),
          stats: { ...stats, uniqueDistanceKm: stats.distanceKm },
        })
      }
    } else if (feat.geometry.type === "MultiLineString") {
      const allTimes: string[][] | undefined =
        feat.properties?.coordinateProperties?.times
      feat.geometry.coordinates.forEach((coords, i) => {
        if (coords.length > 1) {
          const rawCoords = coords as [number, number, number?][]
          const rawPoints = buildRawPoints(rawCoords, allTimes?.[i])
          const ts = rawPoints.map((p) => p.timestampMs)
          const validTs = ts.filter(
            (t): t is number => t != null && isFinite(t)
          )
          const stats = computeActivityStats(rawPoints)
          const coordinates = rawCoords.map((c) => [
            c[0],
            c[1],
          ]) as ActivityCoords
          const startedAtMs = validTs.length > 0 ? validTs[0] : null
          activities.push({
            id: createUuid(),
            name: `${file.name}[${i}]`,
            startedAtMs,
            coordinates,
            startSunPhase: deriveStartSunPhase(coordinates, startedAtMs),
            pointTimestamps: ts.every((t) => t == null)
              ? undefined
              : ts.map((t) => t ?? -1),
            format: "gpx",
            ...(activityType ? { activityType } : {}),
            stats: { ...stats, uniqueDistanceKm: stats.distanceKm },
          })
        }
      })
    }
  }
  return activities
}
