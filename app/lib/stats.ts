import type {
  ElevationPoint,
  RawPoint,
  ActivityStats,
} from "~/types/activities"
import {
  MOVING_TIME_STOPPED_GAP_MS,
  MOVING_TIME_MIN_SPEED_KMH,
  ELEVATION_SMOOTHING_DISTANCE_M,
  ELEVATION_GAIN_STEP_THRESHOLD_M,
} from "~/constants/fog"
import { haversineMeters } from "~/lib/geo"
const MAX_PROFILE_POINTS = 300

// Trailing moving average of elevationM over a distance window: each output
// point averages all samples within the last `windowKm` of travelled
// distance, so the smoothing strength does not depend on the activity's
// sampling frequency.
function smoothElevationByDistance(
  profile: ElevationPoint[],
  windowKm: number
): ElevationPoint[] {
  const result = new Array<ElevationPoint>(profile.length)
  let sum = 0
  let start = 0
  for (let i = 0; i < profile.length; i++) {
    const point = profile[i]
    sum += point.elevationM
    while (point.distanceKm - profile[start].distanceKm > windowKm) {
      sum -= profile[start].elevationM
      start++
    }
    result[i] = {
      distanceKm: point.distanceKm,
      elevationM: sum / (i - start + 1),
    }
  }
  return result
}

// Normalizes raw elevation gain/loss against GPS/barometric sensor noise:
// smooths the elevation series, then only registers a gain/loss step once the
// smoothed trace has drifted past ELEVATION_GAIN_STEP_THRESHOLD_M from the
// last reference point, resetting the reference there.
function computeElevationGainLoss(profile: ElevationPoint[]): {
  gain: number
  loss: number
} {
  if (profile.length < 2) return { gain: 0, loss: 0 }

  const smoothedProfile = smoothElevationByDistance(
    profile,
    ELEVATION_SMOOTHING_DISTANCE_M / 1000
  )
  let gain = 0
  let loss = 0
  let reference = smoothedProfile[0].elevationM
  for (let i = 1; i < smoothedProfile.length; i++) {
    const elevationM = smoothedProfile[i].elevationM
    const diff = elevationM - reference
    if (diff >= ELEVATION_GAIN_STEP_THRESHOLD_M) {
      gain += diff
      reference = elevationM
    } else if (diff <= -ELEVATION_GAIN_STEP_THRESHOLD_M) {
      loss += -diff
      reference = elevationM
    }
  }
  return { gain, loss }
}

export function haversineKm(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  return haversineMeters([lng1, lat1], [lng2, lat2]) / 1000
}

export function computeActivityStats(
  points: RawPoint[],
  maxProfilePoints: number = MAX_PROFILE_POINTS
): Omit<ActivityStats, "uniqueDistanceKm"> {
  if (points.length < 2) {
    return {
      distanceKm: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    }
  }

  let distanceKm = 0
  let movingTimeMs = 0
  let hasTimestamps = false

  const rawProfile: ElevationPoint[] = []
  let runningDistKm = 0

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]

    const segDist = haversineKm(prev.lng, prev.lat, curr.lng, curr.lat)
    distanceKm += segDist
    runningDistKm = distanceKm

    // Moving time
    if (prev.timestampMs != null && curr.timestampMs != null) {
      hasTimestamps = true
      const dt = curr.timestampMs - prev.timestampMs
      if (dt > 0 && dt <= MOVING_TIME_STOPPED_GAP_MS) {
        // Instantaneous speed over this one segment — deliberately NOT an
        // average. It only gates whether the segment counts as moving.
        const segmentSpeedKmh = segDist / (dt / 3_600_000)
        if (segmentSpeedKmh >= MOVING_TIME_MIN_SPEED_KMH) {
          movingTimeMs += dt
        }
      }
    }

    // Elevation profile: collect every point that has elevation
    if (curr.elevationM != null) {
      rawProfile.push({
        distanceKm: runningDistKm,
        elevationM: curr.elevationM,
      })
    }
  }

  // Seed profile with first point if it has elevation
  if (points[0].elevationM != null) {
    rawProfile.unshift({ distanceKm: 0, elevationM: points[0].elevationM })
  }

  const finiteProfile = rawProfile.filter((p) => Number.isFinite(p.elevationM))
  const hasElevation = finiteProfile.length >= 2
  const { gain: elevationGainM, loss: elevationLossM } =
    computeElevationGainLoss(finiteProfile)

  // Downsample profile if too dense
  const elevationProfile =
    rawProfile.length <= maxProfilePoints
      ? rawProfile
      : rawProfile.filter(
          (_, i) => i % Math.ceil(rawProfile.length / maxProfilePoints) === 0
        )

  const firstTimestampMs = points[0].timestampMs
  const lastTimestampMs = points[points.length - 1].timestampMs
  const durationMs =
    firstTimestampMs != null && lastTimestampMs != null
      ? lastTimestampMs - firstTimestampMs
      : null

  const effectiveTimeMs = hasTimestamps ? movingTimeMs : null

  const avgPaceMinPerKm =
    durationMs != null && durationMs > 0 && distanceKm > 0
      ? durationMs / 60_000 / distanceKm
      : null

  const avgMovingPaceMinPerKm =
    effectiveTimeMs != null && effectiveTimeMs > 0 && distanceKm > 0
      ? effectiveTimeMs / 60_000 / distanceKm
      : null

  const avgSpeedKmh =
    durationMs != null && durationMs > 0 && distanceKm > 0
      ? distanceKm / (durationMs / 3_600_000)
      : null

  const avgMovingSpeedKmh =
    effectiveTimeMs != null && effectiveTimeMs > 0 && distanceKm > 0
      ? distanceKm / (effectiveTimeMs / 3_600_000)
      : null

  return {
    distanceKm,
    elevationGainM,
    elevationLossM,
    hasElevation,
    durationMs,
    movingTimeMs: effectiveTimeMs,
    avgPaceMinPerKm,
    avgMovingPaceMinPerKm,
    avgSpeedKmh,
    avgMovingSpeedKmh,
    elevationProfile,
  }
}

/**
 * Compute activity statistics without inventing a segment between paths.
 * Distances, moving time, elevation and profiles are combined per path; only
 * the display duration spans the first and last timestamp in sequence.
 */
export function computeActivityStatsForPaths(
  paths: RawPoint[][],
  maxProfilePoints: number = MAX_PROFILE_POINTS
): Omit<ActivityStats, "uniqueDistanceKm"> {
  if (paths.length === 1)
    return computeActivityStats(paths[0]!, maxProfilePoints)

  const parts = paths.map((path) =>
    computeActivityStats(path, maxProfilePoints)
  )
  const distanceKm = parts.reduce((total, part) => total + part.distanceKm, 0)
  const movingTimeValues = parts
    .map((part) => part.movingTimeMs)
    .filter((value): value is number => value != null)
  const profiles: ElevationPoint[] = []
  let distanceOffset = 0
  for (const part of parts) {
    profiles.push(
      ...part.elevationProfile.map((point) => ({
        distanceKm: point.distanceKm + distanceOffset,
        elevationM: point.elevationM,
      }))
    )
    distanceOffset += part.distanceKm
  }

  const firstTimestampMs = paths
    .flatMap((path) => path)
    .find((point) => point.timestampMs != null)?.timestampMs
  const flattened = paths.flatMap((path) => path)
  const lastTimestampMs = [...flattened]
    .reverse()
    .find((point) => point.timestampMs != null)?.timestampMs
  const durationMs =
    firstTimestampMs != null && lastTimestampMs != null
      ? lastTimestampMs - firstTimestampMs
      : null
  const movingTimeMs =
    movingTimeValues.length > 0
      ? movingTimeValues.reduce((total, value) => total + value, 0)
      : null
  const hasElevation = parts.some((part) => part.hasElevation)
  const elevationProfile =
    profiles.length <= maxProfilePoints
      ? profiles
      : profiles.filter(
          (_, index) =>
            index % Math.ceil(profiles.length / maxProfilePoints) === 0
        )

  return {
    distanceKm,
    elevationGainM: parts.reduce(
      (total, part) => total + part.elevationGainM,
      0
    ),
    elevationLossM: parts.reduce(
      (total, part) => total + part.elevationLossM,
      0
    ),
    hasElevation,
    durationMs,
    movingTimeMs,
    avgPaceMinPerKm:
      durationMs != null && durationMs > 0 && distanceKm > 0
        ? durationMs / 60_000 / distanceKm
        : null,
    avgMovingPaceMinPerKm:
      movingTimeMs != null && movingTimeMs > 0 && distanceKm > 0
        ? movingTimeMs / 60_000 / distanceKm
        : null,
    avgSpeedKmh:
      durationMs != null && durationMs > 0 && distanceKm > 0
        ? distanceKm / (durationMs / 3_600_000)
        : null,
    avgMovingSpeedKmh:
      movingTimeMs != null && movingTimeMs > 0 && distanceKm > 0
        ? distanceKm / (movingTimeMs / 3_600_000)
        : null,
    elevationProfile,
  }
}
