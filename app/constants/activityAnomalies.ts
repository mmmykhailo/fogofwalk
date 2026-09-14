import type { ActivityType } from "~/types/activities"

/** Bump when a threshold or state-machine decision changes. */
export const ANOMALY_ALGORITHM_VERSION = 1

/** Distances below this are not speed-tested for anomaly entry. */
export const MIN_SPEED_TEST_DISTANCE_M = 1_000

/** Hard fallback for edges without usable time metadata. */
export const ABSOLUTE_TELEPORT_DISTANCE_M = 250_000

/** Number of preceding non-zero trusted edges used by the spatial fallback. */
export const SPATIAL_FALLBACK_WINDOW_EDGES = 31

/** Generous lower/upper bounds keep no-time detection useful but conservative. */
export const SPATIAL_FALLBACK_MIN_DISTANCE_M = 10_000
export const SPATIAL_FALLBACK_MAX_DISTANCE_M = 100_000

/** Position uncertainty allowed when a stream snaps back to the trusted route. */
export const REJOIN_POSITION_MARGIN_M = 250

/** Without usable time, a return must be local rather than point-count reachable. */
export const NO_TIMESTAMP_REJOIN_RADIUS_M = 10_000

/** A return point plus these many following points confirms a rejoin. */
export const REJOIN_CONFIRMATION_POINTS = 3
export const REJOIN_CONFIRMATION_EDGES = REJOIN_CONFIRMATION_POINTS - 1

/** Minimum established baseline before an impossible suffix may be trimmed. */
export const TRUSTED_PREFIX_MIN_POINTS = 5
export const TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES = 3

/** Keep reports useful without making logging proportional to file size. */
export const MAX_ANOMALY_EXAMPLES = 20

export const MAX_PLAUSIBLE_SPEED_MPS: Record<ActivityType, number> = {
  walking: 15,
  running: 25,
  cycling: 50,
  kayaking: 25,
  swimming: 10,
  other: 50,
}

export function maxPlausibleSpeed(
  activityType: ActivityType | undefined
): number {
  return MAX_PLAUSIBLE_SPEED_MPS[activityType ?? "other"]
}

export function spatialFallbackDistanceM(medianEdgeM: number): number {
  return Math.min(
    SPATIAL_FALLBACK_MAX_DISTANCE_M,
    Math.max(SPATIAL_FALLBACK_MIN_DISTANCE_M, 1_000 * medianEdgeM)
  )
}
