import type { ElevationPoint, TrackStats } from "~/types/tracks"
import {
  MOVING_TIME_STOPPED_GAP_MS,
  MOVING_TIME_MIN_SPEED_KMH,
  ELEVATION_SMOOTHING_WINDOW,
  ELEVATION_GAIN_STEP_THRESHOLD_M,
} from "~/constants/fog"

export interface RawPoint {
  lng: number
  lat: number
  elevationM?: number
  timestampMs?: number
}

const EARTH_RADIUS_KM = 6371.0088
const MAX_PROFILE_POINTS = 300

function movingAverage(values: number[], window: number): number[] {
  const result = new Array<number>(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    const dropIndex = i - window
    if (dropIndex >= 0) sum -= values[dropIndex]!
    const count = Math.min(i + 1, window)
    result[i] = sum / count
  }
  return result
}

// Normalizes raw elevation gain/loss against GPS/barometric sensor noise:
// smooths the elevation series, then only registers a gain/loss step once the
// smoothed trace has drifted past ELEVATION_GAIN_STEP_THRESHOLD_M from the
// last reference point, resetting the reference there.
function computeElevationGainLoss(elevations: number[]): {
  gain: number
  loss: number
} {
  if (elevations.length < 2) return { gain: 0, loss: 0 }

  const smoothed = movingAverage(elevations, ELEVATION_SMOOTHING_WINDOW)
  let gain = 0
  let loss = 0
  let reference = smoothed[0]!
  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i]! - reference
    if (diff >= ELEVATION_GAIN_STEP_THRESHOLD_M) {
      gain += diff
      reference = smoothed[i]!
    } else if (diff <= -ELEVATION_GAIN_STEP_THRESHOLD_M) {
      loss += -diff
      reference = smoothed[i]!
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
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

export function computeTrackStats(points: RawPoint[]): Omit<TrackStats, "uniqueDistanceKm"> {
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
        const speedKmh = segDist / (dt / 3_600_000)
        if (speedKmh >= MOVING_TIME_MIN_SPEED_KMH) {
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

  const hasElevation = rawProfile.length >= 2
  const { gain: elevationGainM, loss: elevationLossM } =
    computeElevationGainLoss(rawProfile.map((p) => p.elevationM))

  // Downsample profile if too dense
  const elevationProfile =
    rawProfile.length <= MAX_PROFILE_POINTS
      ? rawProfile
      : rawProfile.filter(
          (_, i) => i % Math.ceil(rawProfile.length / MAX_PROFILE_POINTS) === 0
        )

  const durationMs =
    points[0].timestampMs != null &&
    points[points.length - 1].timestampMs != null
      ? points[points.length - 1].timestampMs! - points[0].timestampMs!
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
