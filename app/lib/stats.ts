import type { ElevationPoint, TrackStats } from "~/types/tracks"
import {
  MOVING_TIME_STOPPED_GAP_MS,
  MOVING_TIME_MIN_SPEED_KMH,
} from "~/constants/fog"

export interface RawPoint {
  lng: number
  lat: number
  elevationM?: number
  timestampMs?: number
}

const EARTH_RADIUS_KM = 6371.0088
const MAX_PROFILE_POINTS = 300

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
  let elevationGainM = 0
  let elevationLossM = 0
  let hasElevation = false
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

    // Elevation
    if (prev.elevationM != null && curr.elevationM != null) {
      hasElevation = true
      const delta = curr.elevationM - prev.elevationM
      if (delta > 0) {
        elevationGainM += delta
      } else {
        elevationLossM += Math.abs(delta)
      }
    }

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
