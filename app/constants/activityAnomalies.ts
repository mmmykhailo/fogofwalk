import type { ActivityType } from "~shared/activities"

/** Bump when a threshold or state-machine decision changes. */
export const ANOMALY_ALGORITHM_VERSION = 3

/** Maximum recent trusted edges used by the rolling reliability baselines. */
export const RELIABILITY_WINDOW_EDGES = 31
/** Number of samples required before adaptive limits replace the bootstrap floors. */
export const RELIABILITY_MIN_BASELINE_EDGES = 4

/** Smallest edge that can be locally suspicious. */
export const LOCAL_DISTANCE_FLOOR_M = 100
/** Maximum normal edge relative to the recent trusted median. */
export const LOCAL_DISTANCE_MULTIPLIER = 20
/** Upper bound on an adaptive local edge allowance. */
export const LOCAL_DISTANCE_CEILING_M = 2_000

/** Smallest interval treated as missing recording data. */
export const TIME_GAP_FLOOR_MS = 30_000
/** Maximum normal interval relative to the recent trusted median cadence. */
export const TIME_GAP_MULTIPLIER = 10
/** Longest consecutive interval that may be drawn. */
export const TIME_GAP_CEILING_MS = 120_000

/** Avoid speed decisions dominated by metre-scale GPS noise. */
export const SPEED_TEST_DISTANCE_FLOOR_M = 100
/** Hard geometry jump that is never treated as a normal edge. */
export const HARD_TELEPORT_DISTANCE_M = 250_000
/** FIT fixes worse than this are not trusted. */
export const MAX_TRUSTED_GPS_ACCURACY_M = 100
/** Expands the local distance allowance for known uncertainty. */
export const GPS_ACCURACY_MULTIPLIER = 4

/** Minimum snap-back allowance. */
export const REJOIN_POSITION_FLOOR_M = 100
/** Scales rejoin allowance by expected skipped movement. */
export const REJOIN_DISTANCE_MULTIPLIER = 4
/** Prevents elapsed time from making a local rejoin unbounded. */
export const REJOIN_POSITION_CEILING_M = 1_000
/** Reliable edges required after a proposed rejoin. */
export const REJOIN_CONFIRMATION_EDGES = 2

/** Consecutive reliable edges required to promote a post-jump fragment. */
export const RECOVERY_CONFIRMATION_EDGES = 4
/** Minimum point count for a promoted post-jump fragment. */
export const MIN_RECOVERY_FRAGMENT_POINTS = 5
/** Short bounded candidate runs need stronger evidence than ordinary paths. */
export const SHORT_ISLAND_MAX_POINTS = 2

/** Trusted accuracy samples required before local accuracy comparisons apply. */
export const RELATIVE_ACCURACY_MIN_SAMPLES = 5
/** Accuracy floor used when the local baseline is unusually small. */
export const RELATIVE_ACCURACY_FLOOR_M = 25
/** Maximum local accuracy increase before a point becomes suspect. */
export const RELATIVE_ACCURACY_MULTIPLIER = 5

/** Coordinate speed below this value does not trigger sensor mismatch checks. */
export const SPEED_MISMATCH_COORDINATE_FLOOR_MPS = 5
/** Relative difference required for a recorded-speed mismatch. */
export const SPEED_MISMATCH_RATIO = 4
/** Absolute difference required alongside the mismatch ratio. */
export const SPEED_MISMATCH_DIFFERENCE_MPS = 5

/** Canonical renderability requirement. */
export const MIN_RETAINED_PATH_POINTS = 2
/** Evidence required before an isolated new fragment is accepted. */
export const MIN_CONFIDENT_FRAGMENT_POINTS = 3

/** Minimum stationary window used by pause-drift cleanup. */
export const PAUSE_DRIFT_MIN_DURATION_MS = 60_000
/** Maximum radius of a stationary drift cloud. */
export const PAUSE_DRIFT_MAX_RADIUS_M = 50
/** Maximum first-to-last movement in that cloud. */
export const PAUSE_DRIFT_MAX_NET_DISTANCE_M = 25
/** Minimum accumulated noise before drift cleanup is useful. */
export const PAUSE_DRIFT_MIN_PATH_DISTANCE_M = 100
/** Distinguishes wandering noise from directional travel. */
export const PAUSE_DRIFT_PATH_TO_NET_RATIO = 5
/** Rejects clearly moving windows from pause classification. */
export const PAUSE_DRIFT_MAX_MEDIAN_SPEED_MPS = 2
/** Bounds pause-window memory and per-window checks. */
export const PAUSE_DRIFT_MAX_WINDOW_POINTS = 600

/** Bound on coordinate-free diagnostic examples. */
export const MAX_RELIABILITY_EXAMPLES = 20

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

export function clampReliabilityDistance(value: number): number {
  return Math.min(
    LOCAL_DISTANCE_CEILING_M,
    Math.max(LOCAL_DISTANCE_FLOOR_M, value)
  )
}

export function clampReliabilityTimeGap(value: number): number {
  return Math.min(TIME_GAP_CEILING_MS, Math.max(TIME_GAP_FLOOR_MS, value))
}

// Compatibility aliases retained while the parser/report migration lands.
export const MAX_ANOMALY_EXAMPLES = MAX_RELIABILITY_EXAMPLES
export const MIN_SPEED_TEST_DISTANCE_M = SPEED_TEST_DISTANCE_FLOOR_M
export const ABSOLUTE_TELEPORT_DISTANCE_M = HARD_TELEPORT_DISTANCE_M
export const SPATIAL_FALLBACK_WINDOW_EDGES = RELIABILITY_WINDOW_EDGES
export const REJOIN_POSITION_MARGIN_M = REJOIN_POSITION_FLOOR_M
export const TRUSTED_PREFIX_MIN_POINTS = MIN_CONFIDENT_FRAGMENT_POINTS
export const TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES =
  MIN_CONFIDENT_FRAGMENT_POINTS - 1

/** Legacy helper for callers that only need the old no-time fallback. */
export const SPATIAL_FALLBACK_MIN_DISTANCE_M = LOCAL_DISTANCE_FLOOR_M
export const SPATIAL_FALLBACK_MAX_DISTANCE_M = LOCAL_DISTANCE_CEILING_M
export function spatialFallbackDistanceM(medianEdgeM: number): number {
  return clampReliabilityDistance(medianEdgeM * LOCAL_DISTANCE_MULTIPLIER)
}
