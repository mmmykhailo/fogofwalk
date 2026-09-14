/** Mean Earth radius used by all browser-side geographic calculations. */
export const EARTH_RADIUS_METERS = 6_371_008.8

/** Return the shortest signed longitude delta in degrees. */
export function shortestLongitudeDeltaDegrees(
  from: number,
  to: number
): number {
  let delta = to - from
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

/** Great-circle distance that treats an antimeridian crossing as continuous. */
export function haversineMeters(
  first: readonly [number, number],
  second: readonly [number, number]
): number {
  const radians = Math.PI / 180
  const latitude1 = first[1] * radians
  const latitude2 = second[1] * radians
  const deltaLatitude = (second[1] - first[1]) * radians
  const deltaLongitude =
    shortestLongitudeDeltaDegrees(first[0], second[0]) * radians
  const sinLatitude = Math.sin(deltaLatitude / 2)
  const sinLongitude = Math.sin(deltaLongitude / 2)
  const a =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude
  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  )
}
