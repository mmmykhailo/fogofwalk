import {
  TRAIL_MAX_COORDINATES_PER_FEATURE,
  WEB_MERCATOR_BOUND_TOLERANCE_METERS,
  WEB_MERCATOR_MAX_LATITUDE,
  WEB_MERCATOR_RADIUS_METERS,
  WEB_MERCATOR_WORLD_LIMIT_METERS,
} from "~/constants/trails"
import { TrailTileError } from "~/lib/map/trails/types"
import type { ProjectedTrailGeometry } from "~/lib/map/trails/types"

type LngLat = [number, number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function projectPosition(coordinate: unknown): LngLat | null {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null

  const x = coordinate[0]
  const y = coordinate[1]
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null
  }

  const maximum =
    WEB_MERCATOR_WORLD_LIMIT_METERS + WEB_MERCATOR_BOUND_TOLERANCE_METERS
  if (Math.abs(x) > maximum || Math.abs(y) > maximum) return null

  const lng = (x / WEB_MERCATOR_RADIUS_METERS) * (180 / Math.PI)
  const lat =
    (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_METERS)) - Math.PI / 2) *
    (180 / Math.PI)

  return [
    Math.max(-180, Math.min(180, lng)),
    Math.max(
      -WEB_MERCATOR_MAX_LATITUDE,
      Math.min(WEB_MERCATOR_MAX_LATITUDE, lat)
    ),
  ]
}

export function webMercatorCoordinateToLngLat(
  coordinate: unknown
): LngLat | null {
  return projectPosition(coordinate)
}

export function projectTrailGeometry(
  geometry: unknown,
  remainingTileCoordinates: number
): ProjectedTrailGeometry | null {
  if (!isRecord(geometry) || typeof geometry.type !== "string") return null
  if (
    !Number.isSafeInteger(remainingTileCoordinates) ||
    remainingTileCoordinates < 0
  ) {
    throw new TrailTileError("limit_exceeded")
  }

  let coordinateCount = 0
  const consumeCoordinate = (): void => {
    coordinateCount += 1
    if (
      coordinateCount > TRAIL_MAX_COORDINATES_PER_FEATURE ||
      coordinateCount > remainingTileCoordinates
    ) {
      throw new TrailTileError("limit_exceeded", { coordinateCount })
    }
  }

  const projectLine = (coordinates: unknown): LngLat[] | null => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null

    const projected: LngLat[] = []
    for (const coordinate of coordinates) {
      consumeCoordinate()
      const point = projectPosition(coordinate)
      if (!point) return null
      projected.push(point)
    }
    return projected
  }

  if (geometry.type === "LineString") {
    const projected = projectLine(geometry.coordinates)
    if (!projected) return null
    return {
      geometry: { type: "LineString", coordinates: projected },
      coordinateCount,
    }
  }

  if (
    geometry.type !== "MultiLineString" ||
    !Array.isArray(geometry.coordinates)
  ) {
    return null
  }

  const projectedLines: LngLat[][] = []
  for (const line of geometry.coordinates) {
    const projected = projectLine(line)
    if (!projected) return null
    projectedLines.push(projected)
  }
  if (projectedLines.length === 0) return null

  return {
    geometry: { type: "MultiLineString", coordinates: projectedLines },
    coordinateCount,
  }
}
