export type TrackCoords = [number, number][]

export type RawPoint = {
  lng: number
  lat: number
  elevationM?: number
  timestampMs?: number
}

export interface ElevationPoint {
  distanceKm: number
  elevationM: number
}

export interface TrackStats {
  distanceKm: number
  uniqueDistanceKm: number
  elevationGainM: number
  elevationLossM: number
  hasElevation: boolean
  durationMs: number | null
  movingTimeMs: number | null
  avgPaceMinPerKm: number | null
  avgMovingPaceMinPerKm: number | null
  avgSpeedKmh: number | null
  avgMovingSpeedKmh: number | null
  elevationProfile: ElevationPoint[]
}

/**
 * One lap from a FIT file, stored as an index range into the parent track's
 * `coordinates` rather than as its own geometry.
 *
 * Two invariants other files rely on:
 * - Adjacent laps **share** their boundary point (`laps[k].startIndex ===
 *   laps[k - 1].endIndex`), so lap geometry is `coordinates.slice(startIndex,
 *   endIndex + 1)` and lap distances sum to the track distance.
 * - `stats.uniqueDistanceKm` is always 0 — unique distance is a library-wide
 *   grid computation (`populateUniqueDistances`) that is not meaningful per lap.
 *   Consumers must hide the stat rather than render the zero.
 */
export interface TrackLap {
  /** Original 1-based FIT lap number — stays stable when empty laps are dropped. */
  number: number
  /** Inclusive index into coordinates/pointTimestamps. */
  startIndex: number
  /** Inclusive index into coordinates/pointTimestamps. */
  endIndex: number
  startedAtMs: number | null
  /** FIT lap_trigger: "manual" | "distance" | "time" | … */
  trigger?: string
  stats: TrackStats
}

export interface ParsedTrack {
  id: string
  name: string
  /** Ms timestamp of the first coordinate point. Null when the file has no timestamps. */
  startedAtMs: number | null
  coordinates: TrackCoords
  pointTimestamps?: number[]
  format: "gpx" | "fit"
  stats: TrackStats
  /** FIT laps, when the file has at least two. Never set for GPX. */
  laps?: TrackLap[]
}

export type FogMode = "corridor" | "fill"
export type MapMode = "flat" | "relief"

export type WorkerInboundMessage =
  | { type: "PROCESS_TRACKS"; tracks: ParsedTrack[]; mode: FogMode }
  | { type: "RESET" }

export type WorkerOutboundMessage =
  | {
      type: "FOG_UPDATE"
      fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      processedCount: number
    }
  | { type: "ERROR"; file: string; message: string }
  | { type: "DONE"; processedCount: number }
