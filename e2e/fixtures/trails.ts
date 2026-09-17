export const TRAIL_TEST_ZOOM = 12
export const TRAIL_TEST_WORLD_LIMIT_METERS = 20_037_508.342789244
export const TRAIL_TEST_RADIUS_METERS = 6_378_137
export const TRAIL_TEST_CENTER: [number, number] = [14.42, 50.08]
export const TRAIL_TEST_DENSE_FEATURE_COUNT = 256

export type TrailTestTheme = "hiking" | "cycling"

export function parseTrailTestPath(pathname: string): {
  x: number
  y: number
} | null {
  const match = new RegExp(
    `^/api/v1/tiles/${TRAIL_TEST_ZOOM}/(\\d+)/(\\d+)\\.json$`
  ).exec(pathname)
  if (!match) return null

  return { x: Number(match[1]), y: Number(match[2]) }
}

export function tileForLngLat(coordinate: [number, number]): {
  x: number
  y: number
} {
  const [lng, lat] = coordinate
  const tilesAtZoom = 2 ** TRAIL_TEST_ZOOM
  const x = Math.floor(((lng + 180) / 360) * tilesAtZoom)
  const latRadians = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latRadians)) / Math.PI) / 2) * tilesAtZoom
  )
  return {
    x: Math.max(0, Math.min(tilesAtZoom - 1, x)),
    y: Math.max(0, Math.min(tilesAtZoom - 1, y)),
  }
}

function webMercatorToLngLat(coordinate: [number, number]): [number, number] {
  const [x, y] = coordinate
  const lng = (x / TRAIL_TEST_RADIUS_METERS) * (180 / Math.PI)
  const lat =
    (2 * Math.atan(Math.exp(y / TRAIL_TEST_RADIUS_METERS)) - Math.PI / 2) *
    (180 / Math.PI)
  return [lng, lat]
}

function trailLineWebMercator(
  theme: TrailTestTheme,
  x: number,
  y: number
): [[number, number], [number, number]] {
  const world = TRAIL_TEST_WORLD_LIMIT_METERS
  const tilesAtZoom = 2 ** TRAIL_TEST_ZOOM
  const span = (2 * world) / tilesAtZoom
  const minX = -world + x * span
  const maxY = world - y * span
  const yFraction = theme === "hiking" ? 0.32 : 0.68
  const point = (fractionX: number): [number, number] => [
    minX + span * fractionX,
    maxY - span * yFraction,
  ]
  return [point(0.1), point(0.9)]
}

export function trailLineLngLat(
  theme: TrailTestTheme,
  x: number,
  y: number
): [[number, number], [number, number]] {
  return trailLineWebMercator(theme, x, y).map(webMercatorToLngLat) as [
    [number, number],
    [number, number],
  ]
}

export function makeTrailTile(theme: TrailTestTheme, x: number, y: number) {
  const line = trailLineWebMercator(theme, x, y)
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: theme === "hiking" ? 101 : 202,
        properties: {
          type: "way",
          ...(theme === "hiking"
            ? { shields: ["kct_reg_red-major"] }
            : { shields: [] }),
        },
        geometry: {
          type: "LineString",
          coordinates: line,
        },
      },
    ],
  }
}

export function makeDenseTrailTile(
  theme: TrailTestTheme,
  x: number,
  y: number,
  featureCount = TRAIL_TEST_DENSE_FEATURE_COUNT
) {
  const world = TRAIL_TEST_WORLD_LIMIT_METERS
  const tilesAtZoom = 2 ** TRAIL_TEST_ZOOM
  const span = (2 * world) / tilesAtZoom
  const minX = -world + x * span
  const maxY = world - y * span
  const features = Array.from({ length: featureCount }, (_, index) => {
    const yFraction = 0.08 + ((index + 0.5) / featureCount) * 0.84
    const line: [[number, number], [number, number]] = [
      [minX + span * 0.05, maxY - span * yFraction],
      [minX + span * 0.95, maxY - span * yFraction],
    ]
    return {
      type: "Feature" as const,
      id: theme === "hiking" ? 1_000 + index : 2_000 + index,
      properties: {
        type: "way" as const,
        ...(theme === "hiking"
          ? { shields: [`kct_reg_red-dense-${index}`] }
          : { shields: [] }),
      },
      geometry: { type: "LineString" as const, coordinates: line },
    }
  })

  return { type: "FeatureCollection" as const, features }
}
