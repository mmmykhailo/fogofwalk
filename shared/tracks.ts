/**
 * Track types shared by the browser app and the sync server.
 *
 * This module must stay free of DOM, Bun and Node globals — it is compiled by
 * both tsconfigs. Everything here is a type or a plain constant, so nothing in
 * it reaches either runtime bundle. Client-only concerns (fog modes, worker
 * messages, anything touching the `GeoJSON` global namespace) stay in
 * `app/types/tracks.ts`, which re-exports this file.
 */

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

export type TrackFormat = "gpx" | "fit"

export interface ParsedTrack {
  id: string
  name: string
  /** Ms timestamp of the first coordinate point. Null when the file has no timestamps. */
  startedAtMs: number | null
  coordinates: TrackCoords
  pointTimestamps?: number[]
  format: TrackFormat
  stats: TrackStats
  /** FIT laps, when the file has at least two. Never set for GPX. */
  laps?: TrackLap[]
  /**
   * SHA-256 of the track's canonical geometry — the server's identity for this
   * track, and the only field both sides key on. See `app/lib/trackHash.ts`.
   *
   * Optional because tracks imported before sync existed have none; the sync
   * engine backfills them lazily. Never part of the hash input itself.
   */
  contentHash?: string
  /**
   * Whether this track is visible on the owner's public profile. Private by
   * default; the field is absent in older local tracks and treated as false.
   */
  isPublic?: boolean
}
