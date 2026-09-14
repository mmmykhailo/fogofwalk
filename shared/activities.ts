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

/**
 * A route is allowed to contain disconnected paths.  Keep this alias mutable
 * because the current map/statistics callers still pass ordinary arrays.
 */
export type ActivityPaths = ActivityCoords[]

/** A timestamp aligned with one coordinate; null means that point was undated. */
export type ActivityTimestamp = number | null

export type ActivityPathTimestamps = ActivityTimestamp[]

/**
 * The geometry portion of the next activity contract.  `paths` is the
 * canonical representation; the flat `coordinates` field below remains on
 * ParsedActivity during the compatibility window for existing callers and
 * legacy persisted/sync payloads.
 */
export interface ActivityGeometry {
  paths: ActivityPaths
  pathTimestamps?: ActivityPathTimestamps[]
}

export interface ActivityGeometryDraft {
  /** Legacy one-path input. */
  coordinates?: ActivityCoords
  pointTimestamps?: Array<number | null>
  /** Canonical path-aware input. */
  paths?: ActivityPaths
  pathTimestamps?: ActivityPathTimestamps[]
}

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

/** A range into one disconnected parent activity path. */
export interface ActivityLapPathRange {
  pathIndex: number
  /** Inclusive index within the selected activity path. */
  startIndex: number
  /** Inclusive index within the selected activity path. */
  endIndex: number
}

/**
 * One lap from a FIT file, stored as index ranges into the parent activity
 * paths rather than as its own persisted geometry.
 *
 * Adjacent laps share their boundary point only when they touch inside the
 * same path. `stats.uniqueDistanceKm` is always 0 because unique distance is
 * a library-wide grid computation, not a lap-level value.
 */
export interface ActivityLap {
  /** Original 1-based FIT lap number — stays stable when empty laps are dropped. */
  number: number
  /** Inclusive index into coordinates/pointTimestamps. */
  startIndex: number
  /** Inclusive index into coordinates/pointTimestamps. */
  endIndex: number
  /**
   * Canonical ranges into disconnected activity paths. Legacy flat indexes
   * remain for old records and callers during the migration window.
   */
  pathRanges?: ActivityLapPathRange[]
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

/**
 * The sun's state at an activity's starting point and instant. Calculated
 * locally during import so public profiles never need location data.
 */
export type StartSunPhase =
  | "before_sunrise"
  | "daylight"
  | "after_sunset"
  | "unknown"

export interface ParsedActivity {
  id: string
  name: string
  /** Ms timestamp of the first coordinate point. Null when the file has no timestamps. */
  startedAtMs: number | null
  coordinates: ActivityCoords
  /**
   * Canonical disconnected geometry during the migration window. New imports
   * populate this field; `coordinates` remains a compatibility projection for
   * older map/stat consumers until they migrate to paths.
   */
  paths?: ActivityPaths
  pointTimestamps?: number[]
  /** Timestamp arrays aligned one-for-one with `paths`, when present. */
  pathTimestamps?: ActivityPathTimestamps[]
  format: ActivityFormat
  /** Normalized activity category. Absent when the imported file had no type metadata. */
  activityType?: ActivityType
  /**
   * Sun state derived locally from the first valid coordinate and start time.
   * Optional for activities imported before this fact was introduced.
   */
  startSunPhase?: StartSunPhase
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

/**
 * Canonical activity shape used by the new normalization boundary.  The old
 * ParsedActivity shape is intentionally left intact so storage, map, and sync
 * migrations can land independently.
 */
export type CanonicalActivity = Omit<
  ParsedActivity,
  "coordinates" | "pointTimestamps"
> &
  ActivityGeometry

/** Parser output accepted by the normalization boundary. */
export type ActivityDraft = Omit<
  ParsedActivity,
  "id" | "coordinates" | "pointTimestamps" | "contentHash"
> &
  ActivityGeometryDraft & {
    id?: string
    contentHash?: string
  }
