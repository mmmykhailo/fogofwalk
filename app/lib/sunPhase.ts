import * as SunCalc from "suncalc"

import type { ActivityCoords, StartSunPhase } from "~/types/activities"

/**
 * Classify an activity start without retaining the underlying solar times or
 * location. Polar days/nights and incomplete import metadata are deliberately
 * unknown rather than guesses.
 */
export function deriveStartSunPhase(
  coordinates: ActivityCoords,
  startedAtMs: number | null
): StartSunPhase {
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) return "unknown"

  const start = coordinates.find(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      lng >= -180 &&
      lng <= 180 &&
      lat >= -90 &&
      lat <= 90
  )
  if (!start) return "unknown"

  const [lng, lat] = start
  const { sunrise, sunset } = SunCalc.getTimes(new Date(startedAtMs), lat, lng)
  if (!sunrise || !sunset) return "unknown"
  const sunriseMs = sunrise.getTime()
  const sunsetMs = sunset.getTime()
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs))
    return "unknown"
  if (startedAtMs < sunriseMs) return "before_sunrise"
  if (startedAtMs > sunsetMs) return "after_sunset"
  return "daylight"
}
