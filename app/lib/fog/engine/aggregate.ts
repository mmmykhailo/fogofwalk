import bbox from "@turf/bbox"
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
type Bounds = [number, number, number, number]

const POSITIVE_INDEX_COLUMNS = 36
const POSITIVE_INDEX_ROWS = 18

export interface FogFillComponent {
  features: PolygonFeature[]
  bounds: Bounds
}

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

function featureBounds(feature: PolygonFeature): Bounds {
  const bounds = bbox(feature)
  return [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!]
}

function boundsOverlap(first: Bounds, second: Bounds): boolean {
  return !(
    first[2] < second[0] ||
    first[0] > second[2] ||
    first[3] < second[1] ||
    first[1] > second[3]
  )
}

/**
 * Return coarse spatial cells for a projected mask. One-cell padding keeps
 * masks that meet exactly on a cell boundary in the same candidate search.
 */
function partitionKeys(bounds: Bounds): string[] {
  const minColumn = Math.max(
    0,
    Math.min(
      POSITIVE_INDEX_COLUMNS - 1,
      Math.floor(Math.max(0, Math.min(1, bounds[0])) * POSITIVE_INDEX_COLUMNS) -
        1
    )
  )
  const maxColumn = Math.max(
    0,
    Math.min(
      POSITIVE_INDEX_COLUMNS - 1,
      Math.floor(Math.max(0, Math.min(1, bounds[2])) * POSITIVE_INDEX_COLUMNS) +
        1
    )
  )
  const minRow = Math.max(
    0,
    Math.min(
      POSITIVE_INDEX_ROWS - 1,
      Math.floor(Math.max(0, Math.min(1, bounds[1])) * POSITIVE_INDEX_ROWS) - 1
    )
  )
  const maxRow = Math.max(
    0,
    Math.min(
      POSITIVE_INDEX_ROWS - 1,
      Math.floor(Math.max(0, Math.min(1, bounds[3])) * POSITIVE_INDEX_ROWS) + 1
    )
  )
  const keys: string[] = []
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      keys.push(`${column}:${row}`)
    }
  }
  return keys
}

export interface FogMaskAccumulator {
  mode: FogMode
  projectedMasks: PolygonFeature[]
  /** Spatially indexed positive components used by fill-mode union. */
  fillComponents: FogFillComponent[]
  fillComponentsByPartition: Map<string, Set<FogFillComponent>>
  dirtyPartitions: Set<string>
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
  warnings: string[],
  geometryFallbackCount = 0
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
    geometryFallbackCount,
    partitionCount: 0,
    featureCount: validation.featureCount,
    vertexCount: validation.vertexCount,
  }
}

export function createFogMaskAccumulator(mode: FogMode): FogMaskAccumulator {
  return {
    mode,
    projectedMasks: [],
    fillComponents: [],
    fillComponentsByPartition: new Map(),
    dirtyPartitions: new Set(),
    degraded: false,
    warnings: [],
  }
}

function removeProjectedMask(
  accumulator: FogMaskAccumulator,
  feature: PolygonFeature
): void {
  const index = accumulator.projectedMasks.indexOf(feature)
  if (index < 0) return
  const last = accumulator.projectedMasks.pop()
  if (last && index < accumulator.projectedMasks.length) {
    accumulator.projectedMasks[index] = last
  }
}

function indexFillComponent(
  accumulator: FogMaskAccumulator,
  component: FogFillComponent
): void {
  for (const key of partitionKeys(component.bounds)) {
    accumulator.dirtyPartitions.add(key)
    const components = accumulator.fillComponentsByPartition.get(key)
    if (components) components.add(component)
    else accumulator.fillComponentsByPartition.set(key, new Set([component]))
  }
}

function unindexFillComponent(
  accumulator: FogMaskAccumulator,
  component: FogFillComponent
): void {
  for (const key of partitionKeys(component.bounds)) {
    accumulator.dirtyPartitions.add(key)
    const components = accumulator.fillComponentsByPartition.get(key)
    components?.delete(component)
    if (components?.size === 0) {
      accumulator.fillComponentsByPartition.delete(key)
    }
  }
}

function addFillComponent(
  accumulator: FogMaskAccumulator,
  feature: PolygonFeature
): void {
  const component: FogFillComponent = {
    features: [feature],
    bounds: featureBounds(feature),
  }
  accumulator.fillComponents.push(component)
  accumulator.projectedMasks.push(feature)
  indexFillComponent(accumulator, component)
}

function removeFillComponent(
  accumulator: FogMaskAccumulator,
  component: FogFillComponent
): void {
  const index = accumulator.fillComponents.indexOf(component)
  if (index >= 0) accumulator.fillComponents.splice(index, 1)
  for (const feature of component.features) {
    removeProjectedMask(accumulator, feature)
  }
  unindexFillComponent(accumulator, component)
}

function overlappingFillComponents(
  accumulator: FogMaskAccumulator,
  feature: PolygonFeature
): FogFillComponent[] {
  const bounds = featureBounds(feature)
  const candidates = new Set<FogFillComponent>()
  for (const key of partitionKeys(bounds)) {
    for (const component of accumulator.fillComponentsByPartition.get(key) ??
      []) {
      if (boundsOverlap(bounds, component.bounds)) candidates.add(component)
    }
  }
  return [...candidates]
}

function appendFillMask(
  accumulator: FogMaskAccumulator,
  incoming: PolygonFeature
): void {
  const components = overlappingFillComponents(accumulator, incoming)
  if (components.length === 0) {
    addFillComponent(accumulator, incoming)
    return
  }

  const candidates = [
    ...components.flatMap((component) => component.features),
    incoming,
  ]
  try {
    const merged = union(featureCollection(candidates)) as PolygonFeature | null
    if (!merged) throw new Error("union returned no geometry")
    for (const component of components) {
      removeFillComponent(accumulator, component)
    }
    addFillComponent(accumulator, stripInteriorRings(merged))
  } catch (error) {
    // Retain the already-published positive components and isolate the new
    // difficult geometry. Future appends remain incremental but stop trying to
    // merge every component after one deterministic union failure.
    accumulator.degraded = true
    accumulator.projectedMasks.push(incoming)
    accumulator.fillComponents = []
    accumulator.fillComponentsByPartition.clear()
    accumulator.dirtyPartitions = new Set()
    accumulator.warnings.push(
      `explored-mask union failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Add one activity's masks to the accumulator. Corridor mode appends positive
 * masks directly. Fill mode uses a coarse spatial index so a disjoint append
 * does not re-union the entire library; only intersecting positive components
 * become dirty and are merged.
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

  for (const incoming of projected.map(stripInteriorRings)) {
    appendFillMask(accumulator, incoming)
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
