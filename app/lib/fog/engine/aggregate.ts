import bbox from "@turf/bbox"
import difference from "@turf/difference"
import { featureCollection, polygon } from "@turf/helpers"
import union from "@turf/union"
import earcut from "earcut"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import type { FogMode } from "~/types/activities"
import { FOG_INPUT_DEFAULTS } from "./input"
import type { FogMask } from "./buffer"
import { validateFogRenderData, type FogRenderData } from "./validate"

export const FOG_PARTITION_SCHEME_VERSION = 1

export interface FogPartitionOptions {
  longitudeSpanDegrees?: number
  latitudeSpanDegrees?: number
  maxPartitions?: number
}

export interface FogAggregationResult {
  fogData: FogRenderData
  degraded: boolean
  warnings: string[]
  partitionCount: number
  featureCount: number
  vertexCount: number
}

const WORLD_WEST = -180
const WORLD_EAST = 180
const WORLD_SOUTH = -FOG_INPUT_DEFAULTS.maxLatitude
const WORLD_NORTH = FOG_INPUT_DEFAULTS.maxLatitude
const DEFAULT_LONGITUDE_SPAN = 30
const DEFAULT_LATITUDE_SPAN = 30
const DEFAULT_MAX_PARTITIONS = 10_000

type PolygonFeature = Feature<Polygon | MultiPolygon>

type Coordinate = [number, number]

function projectCoordinate(position: number[]): Coordinate {
  const longitude = position[0]!
  const latitude = Math.max(WORLD_SOUTH, Math.min(WORLD_NORTH, position[1]!))
  const radians = (latitude * Math.PI) / 180
  const sine = Math.sin(radians)
  return [
    (longitude - WORLD_WEST) / (WORLD_EAST - WORLD_WEST),
    0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  ]
}

function unprojectCoordinate(position: number[]): Coordinate {
  const longitude =
    WORLD_WEST +
    Math.max(0, Math.min(1, position[0]!)) * (WORLD_EAST - WORLD_WEST)
  const latitude = Math.max(
    WORLD_SOUTH,
    Math.min(
      WORLD_NORTH,
      (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * position[1]!)))
    )
  )
  return [longitude, latitude]
}

function transformFeature(
  feature: PolygonFeature,
  transform: (position: number[]) => Coordinate
): PolygonFeature {
  if (feature.geometry.type === "Polygon") {
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: feature.geometry.coordinates.map((ring) =>
          ring.map(transform)
        ),
      },
    }
  }
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: feature.geometry.coordinates.map((polygonCoordinates) =>
        polygonCoordinates.map((ring) => ring.map(transform))
      ),
    },
  }
}

function projectFeature(feature: PolygonFeature): PolygonFeature {
  return transformFeature(feature, projectCoordinate)
}

function unprojectFeature(feature: PolygonFeature): PolygonFeature {
  return transformFeature(feature, unprojectCoordinate)
}

function stripInteriorRings(feature: PolygonFeature): PolygonFeature {
  if (feature.geometry.type === "Polygon") {
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: [feature.geometry.coordinates[0]!],
      },
    }
  }
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: feature.geometry.coordinates.map((coordinates) => [
        coordinates[0]!,
      ]),
    },
  }
}

function partitionFeature(
  west: number,
  south: number,
  east: number,
  north: number,
  id: string
): Feature<Polygon, { partitionId: string }> {
  return polygon(
    [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
    { partitionId: id }
  )
}

function buildPartitions(options: FogPartitionOptions): Feature<Polygon>[] {
  const longitudeSpan = options.longitudeSpanDegrees ?? DEFAULT_LONGITUDE_SPAN
  const latitudeSpan = options.latitudeSpanDegrees ?? DEFAULT_LATITUDE_SPAN
  if (
    !Number.isFinite(longitudeSpan) ||
    !Number.isFinite(latitudeSpan) ||
    longitudeSpan <= 0 ||
    latitudeSpan <= 0
  ) {
    throw new Error("Fog partition spans must be positive finite numbers.")
  }
  const maxPartitions = options.maxPartitions ?? DEFAULT_MAX_PARTITIONS
  const longitudePartitionCount = Math.ceil(
    (WORLD_EAST - WORLD_WEST) / longitudeSpan
  )
  const latitudePartitionCount = Math.ceil(
    (WORLD_NORTH - WORLD_SOUTH) / latitudeSpan
  )
  const expectedPartitionCount =
    longitudePartitionCount * latitudePartitionCount
  if (
    !Number.isSafeInteger(maxPartitions) ||
    maxPartitions < 0 ||
    !Number.isSafeInteger(expectedPartitionCount) ||
    expectedPartitionCount > maxPartitions
  ) {
    throw new Error(
      "Fog partition scheme exceeds its technical partition budget."
    )
  }
  const partitions: Feature<Polygon>[] = []
  for (let west = WORLD_WEST; west < WORLD_EAST; west += longitudeSpan) {
    const east = Math.min(WORLD_EAST, west + longitudeSpan)
    for (let south = WORLD_SOUTH; south < WORLD_NORTH; south += latitudeSpan) {
      const north = Math.min(WORLD_NORTH, south + latitudeSpan)
      if (partitions.length >= maxPartitions) {
        throw new Error(
          "Fog partition scheme exceeds its technical partition budget."
        )
      }
      partitions.push(
        partitionFeature(
          west,
          south,
          east,
          north,
          `${west}:${south}:${east}:${north}`
        )
      )
    }
  }
  if (partitions.length > maxPartitions) {
    throw new Error(
      "Fog partition scheme exceeds its technical partition budget."
    )
  }
  return partitions
}

function maskFeatures(masks: FogMask[]): FogMask[] {
  return masks.filter((mask) => Boolean(mask.geometry))
}

function boundsOverlap(first: number[], second: number[]): boolean {
  return !(
    first[2]! < second[0]! ||
    first[0]! > second[2]! ||
    first[3]! < second[1]! ||
    first[1]! > second[3]!
  )
}

function removeClosingPoint(ring: number[][]): [number, number][] {
  const points = ring.map((point) => [point[0]!, point[1]!] as [number, number])
  if (points.length > 1) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (first[0] === last[0] && first[1] === last[1]) points.pop()
  }
  return points
}

function triangulatePolygon(
  coordinates: number[][][],
  properties: { partitionId: string }
): Feature<Polygon, { partitionId: string }>[] {
  if (coordinates.length === 0) return []
  if (coordinates.length === 1) {
    return [
      polygon(
        [coordinates[0]!.map((point) => [point[0]!, point[1]!])],
        properties
      ),
    ]
  }

  const points: [number, number][] = []
  const holeIndices: number[] = []
  for (let index = 0; index < coordinates.length; index += 1) {
    if (index > 0) holeIndices.push(points.length)
    points.push(...removeClosingPoint(coordinates[index]!))
  }
  if (points.length < 3) return []
  const data = points.flatMap(([lng, lat]) => [lng, lat])
  const triangles = earcut(data, holeIndices, 2)
  const features: Feature<Polygon, { partitionId: string }>[] = []
  for (let index = 0; index < triangles.length; index += 3) {
    const first = points[triangles[index]!]!
    const second = points[triangles[index + 1]!]!
    const third = points[triangles[index + 2]!]!
    if (!first || !second || !third) continue
    features.push(polygon([[first, second, third, first]], properties))
  }
  return features
}

function triangulateFeature(
  feature: PolygonFeature,
  properties: { partitionId: string }
): Feature<Polygon, { partitionId: string }>[] {
  if (feature.geometry.type === "Polygon") {
    return triangulatePolygon(feature.geometry.coordinates, properties)
  }
  return feature.geometry.coordinates.flatMap((coordinates) =>
    triangulatePolygon(coordinates, properties)
  )
}

function hasInteriorRings(feature: PolygonFeature): boolean {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.some((_, index) => index > 0)
  }
  return feature.geometry.coordinates.some((polygon) =>
    polygon.some((_, index) => index > 0)
  )
}

function aggregateExploredMasks(
  masks: FogMask[],
  mode: FogMode
): { masks: PolygonFeature[]; degraded: boolean; warnings: string[] } {
  const usable = maskFeatures(masks)
  if (usable.length === 0) return { masks: [], degraded: false, warnings: [] }
  const projected = usable.map(projectFeature)
  if (projected.length === 1) {
    return {
      masks: [
        mode === "fill" ? stripInteriorRings(projected[0]!) : projected[0]!,
      ],
      degraded: false,
      warnings: [],
    }
  }

  try {
    const merged = union(featureCollection(projected)) as PolygonFeature | null
    if (!merged) return { masks: [], degraded: false, warnings: [] }
    return {
      masks: [mode === "fill" ? stripInteriorRings(merged) : merged],
      degraded: false,
      warnings: [],
    }
  } catch (error) {
    // A difficult union must never turn into a false successful fog snapshot.
    // Keeping independent positive masks preserves corridor work; fill mode
    // strips each mask as a conservative degraded fallback.
    return {
      masks: mode === "fill" ? projected.map(stripInteriorRings) : projected,
      degraded: true,
      warnings: [
        `explored-mask union failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
}

/**
 * Build a hole-free inverse mask.  Turf may produce a polygon with route-shaped
 * holes for a partition; those holes are triangulated into ordinary polygons
 * before publication, so MapLibre never clips a world shell and a hole ring
 * independently in the same source feature.
 */
export function buildBoundedFog(
  masks: FogMask[],
  mode: FogMode,
  suppliedOptions: FogPartitionOptions = {}
): FogAggregationResult {
  const partitions = buildPartitions(suppliedOptions)
  const projectedPartitions = partitions.map(projectFeature)
  const explored = aggregateExploredMasks(masks, mode)
  const features: Feature<Polygon, { partitionId: string }>[] = []
  const warnings = [...explored.warnings]
  let degraded = explored.degraded
  const maskBounds = explored.masks.map((mask) => [mask, bbox(mask)] as const)

  for (let index = 0; index < projectedPartitions.length; index += 1) {
    const partition = projectedPartitions[index]!
    const partitionBounds = bbox(partition)
    const candidates = maskBounds
      .filter(([, bounds]) => boundsOverlap(partitionBounds, bounds))
      .map(([mask]) => mask)
    const partitionId = String(partition.properties?.partitionId ?? index)
    if (candidates.length === 0) {
      features.push(
        unprojectFeature(
          partition as Feature<Polygon, { partitionId: string }>
        ) as Feature<Polygon, { partitionId: string }>
      )
      continue
    }

    let remainder: PolygonFeature | null
    try {
      remainder = difference(
        featureCollection([partition, ...candidates])
      ) as PolygonFeature | null
    } catch (error) {
      degraded = true
      warnings.push(
        `partition ${partitionId} difference failed: ${error instanceof Error ? error.message : String(error)}`
      )
      // Safe fallback: this partition remains fogged rather than publishing
      // an unchecked partial geometry.
      features.push(
        unprojectFeature(
          partition as Feature<Polygon, { partitionId: string }>
        ) as Feature<Polygon, { partitionId: string }>
      )
      continue
    }
    if (!remainder) continue

    const pieces = hasInteriorRings(remainder)
      ? triangulateFeature(remainder, { partitionId })
      : remainder.geometry.type === "Polygon"
        ? [
            {
              ...remainder,
              properties: { partitionId },
            } as Feature<Polygon, { partitionId: string }>,
          ]
        : remainder.geometry.coordinates.map((coordinates) =>
            polygon(coordinates, { partitionId })
          )
    if (pieces.length === 0) {
      degraded = true
      warnings.push(`partition ${partitionId} produced no valid inverse pieces`)
      features.push(
        unprojectFeature(
          partition as Feature<Polygon, { partitionId: string }>
        ) as Feature<Polygon, { partitionId: string }>
      )
      continue
    }
    features.push(
      ...pieces.map(
        (piece) =>
          unprojectFeature(piece) as Feature<Polygon, { partitionId: string }>
      )
    )
  }

  const fogData: FogRenderData = featureCollection(features)
  const validation = validateFogRenderData(fogData)
  if (!validation.ok) {
    degraded = true
    warnings.push(...validation.errors.map((message) => `output: ${message}`))
    // Never return an unchecked geometry. The default world partition set is
    // deliberately simple and remains a safe last resort when a difficult
    // route or an unexpected output budget makes the calculated inverse
    // unsuitable for publication.
    const safeFogData: FogRenderData = featureCollection(buildPartitions({}))
    const safeValidation = validateFogRenderData(safeFogData)
    return {
      fogData: safeFogData,
      degraded: true,
      warnings: [...warnings, "published the validated world fallback"],
      partitionCount: buildPartitions({}).length,
      featureCount: safeValidation.featureCount,
      vertexCount: safeValidation.vertexCount,
    }
  }
  return {
    fogData,
    degraded,
    warnings,
    partitionCount: partitions.length,
    featureCount: validation.featureCount,
    vertexCount: validation.vertexCount,
  }
}

/** Produce the full bounded world mask for an empty library. */
export function emptyBoundedFog(
  options: FogPartitionOptions = {}
): FogAggregationResult {
  return buildBoundedFog([], "corridor", options)
}
