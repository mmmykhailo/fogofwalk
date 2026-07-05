export type TrackCoords = [number, number][]

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

export interface ParsedTrack {
  id: string
  name: string
  /** Ms timestamp of the first coordinate point. Null when the file has no timestamps. */
  startedAtMs: number | null
  coordinates: TrackCoords
  pointTimestamps?: number[]
  format: "gpx" | "fit"
  stats: TrackStats
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
