/**
 * Activity types shared by the browser app and the sync server.
 *
 * This module must stay free of DOM, Bun and Node globals — it is compiled by
 * both tsconfigs. Everything here is a type or a plain constant, so nothing in
 * it reaches either runtime bundle. Client-only concerns (fog modes, worker
 * messages, anything touching the `GeoJSON` global namespace) stay in
 * `app/types/activities.ts`, which re-exports this file.
 */

export type ActivityCoords = [number, number][]

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

export interface ActivityStats {
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
 * One lap from a FIT file, stored as an index range into the parent activity's
 * `coordinates` rather than as its own geometry.
 *
 * Two invariants other files rely on:
 * - Adjacent laps **share** their boundary point (`laps[k].startIndex ===
 *   laps[k - 1].endIndex`), so lap geometry is `coordinates.slice(startIndex,
 *   endIndex + 1)` and lap distances sum to the activity distance.
 * - `stats.uniqueDistanceKm` is always 0 — unique distance is a library-wide
 *   grid computation (`populateUniqueDistances`) that is not meaningful per lap.
 *   Consumers must hide the stat rather than render the zero.
 */
export interface ActivityLap {
  /** Original 1-based FIT lap number — stays stable when empty laps are dropped. */
  number: number
  /** Inclusive index into coordinates/pointTimestamps. */
  startIndex: number
  /** Inclusive index into coordinates/pointTimestamps. */
  endIndex: number
  startedAtMs: number | null
  /** FIT lap_trigger: "manual" | "distance" | "time" | … */
  trigger?: string
  stats: ActivityStats
}

export type ActivityFormat = "gpx" | "fit"

export const ACTIVITY_TYPES = [
  "walking",
  "running",
  "cycling",
  "kayaking",
  "swimming",
  "other",
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export interface ParsedActivity {
  id: string
  name: string
  /** Ms timestamp of the first coordinate point. Null when the file has no timestamps. */
  startedAtMs: number | null
  coordinates: ActivityCoords
  pointTimestamps?: number[]
  format: ActivityFormat
  /** Normalized activity category. Absent when the imported file had no type metadata. */
  activityType?: ActivityType
  stats: ActivityStats
  /** FIT laps, when the file has at least two. Never set for GPX. */
  laps?: ActivityLap[]
  /**
   * SHA-256 of the activity's canonical geometry — the server's identity for this
   * activity, and the only field both sides key on. See `app/lib/activityHash.ts`.
   *
   * Optional because activities imported before sync existed have none; the sync
   * engine backfills them lazily. Never part of the hash input itself.
   */
  contentHash?: string
  /**
   * Whether this activity is visible on the owner's public profile. Private by
   * default; the field is absent in older local activities and treated as false.
   */
  isPublic?: boolean
}
