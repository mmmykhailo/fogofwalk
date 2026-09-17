import { zxyToTileId } from "pmtiles"

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
  const { projected, scale } = projectedLine(coordinates, zoom)
  let minProjectedX = Infinity
  let minProjectedY = Infinity
  let maxProjectedX = -Infinity
  let maxProjectedY = -Infinity
  for (const [x, y] of projected) {
    minProjectedX = Math.min(minProjectedX, x)
    minProjectedY = Math.min(minProjectedY, y)
    maxProjectedX = Math.max(maxProjectedX, x)
    maxProjectedY = Math.max(maxProjectedY, y)
  }
  return {
    minX: tileCoordinate(minProjectedX, scale),
    minY: tileCoordinate(minProjectedY, scale),
    maxX: tileCoordinate(maxProjectedX, scale),
    maxY: tileCoordinate(maxProjectedY, scale),
  }
}

/**
 * Returns only z/x/y tiles touched by the line, plus tiles reached by the
 * 64-unit vector-tile buffer. Grid traversal avoids expanding a long way's
 * entire projected bounding rectangle, which can be much larger than its
 * actual path.
 */
export function tileCandidatesForCoordinates(
  coordinates: Coordinate[],
  zoom: number
): number[] {
  const { projected, scale } = projectedLine(coordinates, zoom)
  const candidates = new Set<number>()
  const buffer = 64 / (4096 * scale)
  for (let index = 1; index < projected.length; index++) {
    const start = projected[index - 1]
    const end = projected[index]
    for (const [cellX, cellY] of segmentTileCells(start, end, scale)) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          const tileX = cellX + offsetX
          const tileY = cellY + offsetY
          if (
            tileX < 0 ||
            tileY < 0 ||
            tileX >= scale ||
            tileY >= scale ||
            !segmentIntersectsRectangle(
              start,
              end,
              tileX / scale - buffer,
              (tileX + 1) / scale + buffer,
              tileY / scale - buffer,
              (tileY + 1) / scale + buffer
            )
          ) {
            continue
          }
          candidates.add(zxyToTileId(zoom, tileX, tileY))
        }
      }
    }
  }
  return [...candidates].sort((a, b) => a - b)
}

function projectedLine(
  coordinates: Coordinate[],
  zoom: number
): { projected: Coordinate[]; scale: number } {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 26) {
    throw new Error("tile zoom must be an integer in the 0-26 range")
  }
  if (!isValidLineString(coordinates))
    throw new Error("cannot tile invalid line geometry")
  const scale = 2 ** zoom
  return { projected: coordinates.map(projectWebMercator), scale }
}

function tileCoordinate(value: number, scale: number): number {
  return Math.max(0, Math.min(scale - 1, Math.floor(value * scale)))
}

function segmentTileCells(
  start: Coordinate,
  end: Coordinate,
  scale: number
): Array<[number, number]> {
  const [startX, startY] = start
  const [endX, endY] = end
  const deltaX = endX - startX
  const deltaY = endY - startY
  let cellX = startingTileCoordinate(startX, deltaX, scale)
  let cellY = startingTileCoordinate(startY, deltaY, scale)
  const cells: Array<[number, number]> = [[cellX, cellY]]
  const stepX = Math.sign(deltaX)
  const stepY = Math.sign(deltaY)
  const deltaTileX = deltaX === 0 ? Infinity : 1 / (Math.abs(deltaX) * scale)
  const deltaTileY = deltaY === 0 ? Infinity : 1 / (Math.abs(deltaY) * scale)
  let nextBoundaryX =
    stepX > 0
      ? ((cellX + 1) / scale - startX) / deltaX
      : stepX < 0
        ? (startX - cellX / scale) / -deltaX
        : Infinity
  let nextBoundaryY =
    stepY > 0
      ? ((cellY + 1) / scale - startY) / deltaY
      : stepY < 0
        ? (startY - cellY / scale) / -deltaY
        : Infinity

  while (true) {
    if (nextBoundaryX < nextBoundaryY) {
      if (nextBoundaryX > 1) break
      cellX += stepX
      cells.push([cellX, cellY])
      nextBoundaryX += deltaTileX
    } else if (nextBoundaryY < nextBoundaryX) {
      if (nextBoundaryY > 1) break
      cellY += stepY
      cells.push([cellX, cellY])
      nextBoundaryY += deltaTileY
    } else {
      if (nextBoundaryX > 1) break
      cellX += stepX
      cellY += stepY
      cells.push([cellX, cellY])
      nextBoundaryX += deltaTileX
      nextBoundaryY += deltaTileY
    }
  }
  return cells.filter(
    ([x, y]) => x >= 0 && y >= 0 && x < scale && y < scale
  )
}

function startingTileCoordinate(
  value: number,
  delta: number,
  scale: number
): number {
  const bounded = Math.max(0, Math.min(1 - Number.EPSILON, value))
  const scaled = bounded * scale
  const floor = Math.floor(scaled)
  if (delta < 0 && Number.isInteger(scaled) && floor > 0) return floor - 1
  return Math.max(0, Math.min(scale - 1, floor))
}

function segmentIntersectsRectangle(
  start: Coordinate,
  end: Coordinate,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean {
  let lower = 0
  let upper = 1
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  for (const [p, q] of [
    [-deltaX, start[0] - minX],
    [deltaX, maxX - start[0]],
    [-deltaY, start[1] - minY],
    [deltaY, maxY - start[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const ratio = q / p
    if (p < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return false
  }
  return true
}

function stableFeatureId(wayId: number, visualIndex: number): number {
  const id = wayId * 16 + visualIndex
  if (!Number.isSafeInteger(id))
    throw new Error(`way id cannot form a stable feature id: ${wayId}`)
  return id
}
