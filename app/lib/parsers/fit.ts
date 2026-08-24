import FitParser from "fit-file-parser"
import type {
  ParsedTrack,
  RawPoint,
  TrackCoords,
  TrackLap,
} from "~/types/tracks"
import { computeTrackStats } from "~/lib/stats"
import { LAP_PROFILE_POINTS, MAX_LAPS } from "~/constants/fog"
import { normalizeActivityType } from "~/lib/activityType"

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
 * contiguous, non-overlapping and exhaustive by construction. This is also why
 * the sweep runs over `rawPoints` and not over the raw FIT records: the record
 * filter below drops null-lat/lng and null-island records first, so record
 * indices and rawPoint indices do not line up.
 *
 * Returns `undefined` when there is nothing worth showing a selector for.
 *
 * Exported for the same reason as `fitTimeToMs`; `parseFitFile` is the only
 * production caller.
 */
export function buildLapsFromFit(
  rawPoints: RawPoint[],
  fitLaps: unknown[]
): TrackLap[] | undefined {
  if (rawPoints.length < 2 || fitLaps.length < 2) return undefined
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

  // Forward sweep: each point joins the latest lap whose start time it has
  // reached. Points before the first boundary fall into lap 0, and points with
  // no timestamp inherit the current lap rather than being dropped — either
  // would punch a hole in an otherwise contiguous range.
  const firstIndex = new Array<number>(boundaries.length).fill(-1)
  const lastIndex = new Array<number>(boundaries.length).fill(-1)
  let lapIdx = 0
  for (let i = 0; i < rawPoints.length; i++) {
    const ts = rawPoints[i].timestampMs
    if (ts != null) {
      while (
        lapIdx + 1 < boundaries.length &&
        ts >= boundaries[lapIdx + 1].startMs
      ) {
        lapIdx++
      }
    }
    if (firstIndex[lapIdx] === -1) firstIndex[lapIdx] = i
    lastIndex[lapIdx] = i
  }

  const laps: TrackLap[] = []
  for (let k = 0; k < boundaries.length; k++) {
    if (firstIndex[k] === -1) continue // lap with no surviving GPS points
    // Extend backwards to the previous lap's last point so the highlighted
    // polylines are contiguous and lap distances sum to the track distance.
    const prev = laps[laps.length - 1]
    const startIndex = prev ? prev.endIndex : firstIndex[k]
    const endIndex = lastIndex[k]
    if (endIndex - startIndex < 1) continue // needs 2+ points to be a LineString

    const slice = rawPoints.slice(startIndex, endIndex + 1)
    const stats = computeTrackStats(slice, LAP_PROFILE_POINTS)

    // The shared boundary point means durationMs would also count the gap
    // bridging into this lap — minutes if the user pressed lap while standing
    // still. The device's own total_elapsed_time is both correct and what the
    // watch and Strava display, so prefer it when present.
    const elapsedMs =
      boundaries[k].totalElapsedTimeS != null &&
      isFinite(boundaries[k].totalElapsedTimeS as number)
        ? (boundaries[k].totalElapsedTimeS as number) * 1000
        : null
    const durationMs = elapsedMs ?? stats.durationMs
    const avgPaceMinPerKm =
      durationMs != null && durationMs > 0 && stats.distanceKm > 0
        ? durationMs / 60_000 / stats.distanceKm
        : null
    const avgSpeedKmh =
      durationMs != null && durationMs > 0 && stats.distanceKm > 0
        ? stats.distanceKm / (durationMs / 3_600_000)
        : null

    const startTs = rawPoints[startIndex].timestampMs
    laps.push({
      number: boundaries[k].number,
      startIndex,
      endIndex,
      startedAtMs: startTs != null && isFinite(startTs) ? startTs : null,
      trigger: boundaries[k].trigger,
      stats: {
        ...stats,
        durationMs,
        avgPaceMinPerKm,
        avgSpeedKmh,
        // Unique distance is a library-wide grid computation that would shift
        // whenever an unrelated track is imported. Not meaningful per lap.
        uniqueDistanceKm: 0,
      },
    })
  }

  // One lap spanning the whole activity is what every FIT has; a selector with
  // a single entry identical to "All" is noise.
  return laps.length >= 2 ? laps : undefined
}

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
    const ts = fitTimeToMs(r.timestamp)
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
  const laps = buildLapsFromFit(rawPoints, data.laps ?? [])
  const activityType = normalizeActivityType(
    data.sessions?.[0]?.sport ?? data.sports?.[0]?.sport
  )
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
      ...(activityType ? { activityType } : {}),
      stats: { ...stats, uniqueDistanceKm: stats.distanceKm },
      ...(laps ? { laps } : {}),
    },
  ]
}
