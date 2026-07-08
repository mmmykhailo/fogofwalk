import FitParser from "fit-file-parser"
import type { ParsedTrack, RawPoint, TrackCoords } from "~/types/tracks"
import { computeTrackStats } from "~/lib/stats"

export async function parseFitFile(file: File): Promise<ParsedTrack[]> {
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

  if (validRecords.length < 2) return []

  const rawPoints: RawPoint[] = validRecords.map((r) => {
    const alt = r.enhanced_altitude ?? r.altitude
    const ts = Date.parse(r.timestamp)
    return {
      lng: r.position_long as number,
      lat: r.position_lat as number,
      elevationM: typeof alt === "number" && isFinite(alt) ? alt : undefined,
      timestampMs: isFinite(ts) ? ts : undefined,
    }
  })

  const coords: TrackCoords = rawPoints.map((p) => [p.lng, p.lat])
  const ts = rawPoints.map((p) => p.timestampMs)

  const validTs = ts.filter((t): t is number => t != null && isFinite(t))
  const stats = computeTrackStats(rawPoints)
  return [
    {
      id: crypto.randomUUID(),
      name: file.name,
      startedAtMs: validTs.length > 0 ? validTs[0] : null,
      coordinates: coords,
      pointTimestamps: ts.every((t) => t == null)
        ? undefined
        : ts.map((t) => t ?? -1),
      format: "fit",
      stats: { ...stats, uniqueDistanceKm: stats.distanceKm },
    },
  ]
}
