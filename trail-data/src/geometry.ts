import {
  selectVisualFeatures,
  type TrailMembership,
  type TrailTilePropertiesV1,
} from "./classifier"
import type { OsmNode, OsmWay } from "./osm-xml-fixture"

export type Coordinate = [number, number]

export interface TrailLineFeature {
  type: "Feature"
  id: number
  properties: TrailTilePropertiesV1
  geometry: {
    type: "LineString"
    coordinates: Coordinate[]
  }
  wayId: number
}

export interface GeometryBounds {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export interface AssembledWay {
  features: TrailLineFeature[]
  droppedKeys: number
  invalid: boolean
}

export interface TileRange {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const WEB_MERCATOR_MAX_LAT = 85.0511287798066

export function assembleWayFeatures(
  way: OsmWay,
  nodes: Map<number, OsmNode>,
  memberships: TrailMembership[]
): AssembledWay {
  if (way.nodeRefs.length < 2) {
    return { features: [], droppedKeys: 0, invalid: true }
  }
  const coordinates: Coordinate[] = []
  for (const nodeRef of way.nodeRefs) {
    const node = nodes.get(nodeRef)
    if (!node || !Number.isFinite(node.lon) || !Number.isFinite(node.lat)) {
      return { features: [], droppedKeys: 0, invalid: true }
    }
    coordinates.push([node.lon, node.lat])
  }
  if (!isValidLineString(coordinates)) {
    return { features: [], droppedKeys: 0, invalid: true }
  }

  const selection = selectVisualFeatures(memberships)
  return {
    features: selection.features.map((visual, index) => ({
      type: "Feature",
      id: stableFeatureId(way.id, index),
      properties: {
        kind: visual.kind,
        color: visual.color,
        offset: visual.offset,
        sort: visual.sort,
      },
      geometry: { type: "LineString", coordinates },
      wayId: way.id,
    })),
    droppedKeys: selection.droppedKeys,
    invalid: false,
  }
}

export function isValidLineString(coordinates: Coordinate[]): boolean {
  return (
    coordinates.length >= 2 &&
    coordinates.every(
      ([lon, lat]) =>
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= -180 &&
        lon <= 180 &&
        lat >= -90 &&
        lat <= 90
    )
  )
}

export function boundsForCoordinates(
  coordinates: Coordinate[]
): GeometryBounds {
  if (!isValidLineString(coordinates))
    throw new Error("cannot calculate invalid line bounds")
  return coordinates.reduce<GeometryBounds>(
    (bounds, [lon, lat]) => ({
      minLon: Math.min(bounds.minLon, lon),
      minLat: Math.min(bounds.minLat, lat),
      maxLon: Math.max(bounds.maxLon, lon),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    {
      minLon: Infinity,
      minLat: Infinity,
      maxLon: -Infinity,
      maxLat: -Infinity,
    }
  )
}

export function mergeBounds(
  current: GeometryBounds | null,
  next: GeometryBounds
): GeometryBounds {
  if (!current) return next
  return {
    minLon: Math.min(current.minLon, next.minLon),
    minLat: Math.min(current.minLat, next.minLat),
    maxLon: Math.max(current.maxLon, next.maxLon),
    maxLat: Math.max(current.maxLat, next.maxLat),
  }
}

export function projectWebMercator([lon, lat]: Coordinate): Coordinate {
  const boundedLat = Math.max(
    -WEB_MERCATOR_MAX_LAT,
    Math.min(WEB_MERCATOR_MAX_LAT, lat)
  )
  const radians = (boundedLat * Math.PI) / 180
  return [(lon + 180) / 360, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2]
}

export function tileRangeForCoordinates(
  coordinates: Coordinate[],
  zoom: number
): TileRange {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 26) {
    throw new Error("tile zoom must be an integer in the 0-26 range")
  }
  if (!isValidLineString(coordinates))
    throw new Error("cannot tile invalid line geometry")
  const scale = 2 ** zoom
  const projected = coordinates.map(projectWebMercator)
  const minX = Math.max(
    0,
    Math.min(
      scale - 1,
      Math.floor(Math.min(...projected.map(([x]) => x)) * scale)
    )
  )
  const maxX = Math.max(
    0,
    Math.min(
      scale - 1,
      Math.floor(Math.max(...projected.map(([x]) => x)) * scale)
    )
  )
  const minY = Math.max(
    0,
    Math.min(
      scale - 1,
      Math.floor(Math.min(...projected.map(([, y]) => y)) * scale)
    )
  )
  const maxY = Math.max(
    0,
    Math.min(
      scale - 1,
      Math.floor(Math.max(...projected.map(([, y]) => y)) * scale)
    )
  )
  return { minX, minY, maxX, maxY }
}

function stableFeatureId(wayId: number, visualIndex: number): number {
  const id = wayId * 16 + visualIndex
  if (!Number.isSafeInteger(id))
    throw new Error(`way id cannot form a stable feature id: ${wayId}`)
  return id
}
