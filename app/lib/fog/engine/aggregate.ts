import { featureCollection } from "@turf/helpers"
import union from "@turf/union"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import type { FogMode } from "~/types/activities"
import { FOG_INPUT_DEFAULTS } from "./input"
import type { FogMask } from "./buffer"
import { validateFogRenderData, type FogRenderData } from "./validate"

/**
 * Kept as a compatibility surface for callers that used to tune the regional
 * inverse grid. Positive explored masks no longer need geographic partitions,
 * but validating the old knobs keeps malformed configuration fail-closed.
 */
export interface FogPartitionOptions {
  longitudeSpanDegrees?: number
  latitudeSpanDegrees?: number
  maxPartitions?: number
}

export interface FogAggregationResult {
  /** Positive explored geometry; the custom map layer supplies the fog quad. */
  fogData: FogRenderData
  degraded: boolean
  warnings: string[]
  warningCounts: Record<string, number>
  geometryFallbackCount: number
  /** Always zero for the positive-mask representation. */
  partitionCount: number
  featureCount: number
  vertexCount: number
}

const WORLD_WEST = -180
const WORLD_EAST = 180
const DEFAULT_LONGITUDE_SPAN = 30
const DEFAULT_LATITUDE_SPAN = 30
const DEFAULT_MAX_PARTITIONS = 10_000

type PolygonFeature = Feature<Polygon | MultiPolygon>
type Coordinate = [number, number]

function validateLegacyPartitionOptions(options: FogPartitionOptions): void {
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
    (FOG_INPUT_DEFAULTS.maxLatitude * 2) / latitudeSpan
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
}

function projectCoordinate(position: number[]): Coordinate {
  const longitude = position[0]!
  const latitude = Math.max(
    -FOG_INPUT_DEFAULTS.maxLatitude,
    Math.min(FOG_INPUT_DEFAULTS.maxLatitude, position[1]!)
  )
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
    -FOG_INPUT_DEFAULTS.maxLatitude,
    Math.min(
      FOG_INPUT_DEFAULTS.maxLatitude,
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

function maskFeatures(masks: FogMask[]): PolygonFeature[] {
  return masks.filter((mask): mask is PolygonFeature => Boolean(mask.geometry))
}

export interface FogMaskAccumulator {
  mode: FogMode
  projectedMasks: PolygonFeature[]
  degraded: boolean
  warnings: string[]
}

function warningCountKey(message: string): string {
  return message.startsWith("explored-mask union failed")
    ? "explored-mask-union-failed"
    : "geometry-fallback"
}

function aggregationResult(
  fogData: FogRenderData,
  degraded: boolean,
  warnings: string[]
): FogAggregationResult {
  const validation = validateFogRenderData(fogData, {
    allowInteriorRings: true,
  })
  if (!validation.ok) {
    const validationWarnings = validation.errors.map(
      (message) => `output: ${message}`
    )
    const allWarnings = [...warnings, ...validationWarnings]
    const warningCounts = allWarnings.reduce<Record<string, number>>(
      (counts, message) => {
        const key = warningCountKey(message)
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      },
      {}
    )
    return {
      fogData: featureCollection([]),
      degraded: true,
      warnings: [...allWarnings, "published the validated full-fog fallback"],
      warningCounts: {
        ...warningCounts,
        "full-fog-fallback": 1,
      },
      geometryFallbackCount: 1,
      partitionCount: 0,
      featureCount: 0,
      vertexCount: 0,
    }
  }
  const warningCounts = warnings.reduce<Record<string, number>>(
    (counts, message) => {
      const key = warningCountKey(message)
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    },
    {}
  )
  return {
    fogData,
    degraded,
    warnings,
    warningCounts,
    geometryFallbackCount: degraded ? 1 : 0,
    partitionCount: 0,
    featureCount: validation.featureCount,
    vertexCount: validation.vertexCount,
  }
}

export function createFogMaskAccumulator(mode: FogMode): FogMaskAccumulator {
  return { mode, projectedMasks: [], degraded: false, warnings: [] }
}

/**
 * Add one activity's masks to the accumulator. Fill mode unions only the
 * existing positive accumulator with the new masks; it never re-unions the
 * entire activity library for every progress snapshot.
 */
export function appendFogMasks(
  accumulator: FogMaskAccumulator,
  masks: FogMask[]
): void {
  const projected = maskFeatures(masks).map(projectFeature)
  if (projected.length === 0) return
  if (accumulator.mode === "corridor" || accumulator.degraded) {
    accumulator.projectedMasks.push(
      ...(accumulator.mode === "fill"
        ? projected.map(stripInteriorRings)
        : projected)
    )
    return
  }

  const incoming = projected.map(stripInteriorRings)
  const candidates = [...accumulator.projectedMasks, ...incoming]
  if (candidates.length === 1) {
    accumulator.projectedMasks = candidates
    return
  }
  try {
    const merged = union(featureCollection(candidates)) as PolygonFeature | null
    if (!merged) throw new Error("union returned no geometry")
    accumulator.projectedMasks = [stripInteriorRings(merged)]
  } catch (error) {
    accumulator.degraded = true
    accumulator.projectedMasks = candidates
    accumulator.warnings.push(
      `explored-mask union failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function finalizeFogMaskAccumulator(
  accumulator: FogMaskAccumulator,
  suppliedOptions: FogPartitionOptions = {}
): FogAggregationResult {
  validateLegacyPartitionOptions(suppliedOptions)
  const fogData: FogRenderData = featureCollection(
    accumulator.projectedMasks.map((mask) => unprojectFeature(mask))
  )
  return aggregationResult(fogData, accumulator.degraded, [
    ...accumulator.warnings,
  ])
}

/**
 * Build positive explored geometry for the map stencil. `buildBoundedFog` is
 * retained as the public name so storage and old adapters keep compiling, but
 * it no longer builds a world-minus-route inverse.
 */
export function buildBoundedFog(
  masks: FogMask[],
  mode: FogMode,
  suppliedOptions: FogPartitionOptions = {}
): FogAggregationResult {
  const accumulator = createFogMaskAccumulator(mode)
  appendFogMasks(accumulator, masks)
  return finalizeFogMaskAccumulator(accumulator, suppliedOptions)
}

/** Produce an empty positive mask; the custom layer then covers the world. */
export function emptyBoundedFog(
  options: FogPartitionOptions = {}
): FogAggregationResult {
  validateLegacyPartitionOptions(options)
  return aggregationResult(featureCollection([]), false, [])
}
