import bbox from "@turf/bbox"
import { featureCollection } from "@turf/helpers"
import simplify from "@turf/simplify"
import union from "@turf/union"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import { SIMPLIFY_TOLERANCE } from "~/constants/fog"
import type { FogMode } from "~/types/activities"
import {
  MAX_FOG_DIAGNOSTIC_EXAMPLES,
  fogDiagnosticSeverity,
  incrementDiagnosticCount,
} from "../diagnostics"
import { FOG_INPUT_DEFAULTS } from "./input"
import type { FogMask } from "./buffer"
import {
  FOG_OUTPUT_DEFAULTS,
  validateFogRenderData,
  validateFogRenderFeature,
  type FogRenderData,
} from "./validate"

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
  infoCounts: Record<string, number>
  coverageReducedCounts: Record<string, number>
  errorCounts: Record<string, number>
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
type FillUnionOperation = typeof union

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
  warningCounts: Record<string, number>
}

function addExample(examples: string[], message: string): void {
  if (
    message.length > 0 &&
    examples.length < MAX_FOG_DIAGNOSTIC_EXAMPLES &&
    !examples.includes(message)
  ) {
    examples.push(message)
  }
}

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== "string") return Number.POSITIVE_INFINITY
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(serialized).byteLength
    }
    return serialized.length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function textByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength
  }
  return value.length
}

/**
 * Normalize emitted positive geometry after accumulation. This deliberately
 * lives outside the input sanitizer: activity and fog-output tolerances are
 * independent contracts.
 */
export function simplifyFogForEmission(
  feature: PolygonFeature
): PolygonFeature {
  return simplify(feature, {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: false,
    mutate: false,
  }) as PolygonFeature
}

interface AcceptedFeature {
  feature: PolygonFeature
  sourceIndex: number
}

function recordValidationFailure(
  warnings: string[],
  warningCounts: Record<string, number>,
  coverageReducedCounts: Record<string, number>,
  errorCounts: Record<string, number>,
  sourceIndex: number,
  code: string
): void {
  incrementDiagnosticCount(warningCounts, code)
  incrementDiagnosticCount(coverageReducedCounts, code)
  if (fogDiagnosticSeverity(code) === "error") {
    incrementDiagnosticCount(errorCounts, code)
  }
  addExample(
    warnings,
    `explored feature ${sourceIndex} was omitted after ${code.replaceAll("_", " ")}`
  )
}

function aggregationResult(
  inputFogData: FogRenderData,
  degraded: boolean,
  warnings: string[],
  geometryFallbackCount = 0,
  inheritedWarningCounts: Record<string, number> = {}
): FogAggregationResult {
  const accepted: AcceptedFeature[] = []
  const warningExamples = warnings.slice(0, MAX_FOG_DIAGNOSTIC_EXAMPLES)
  const warningCounts = { ...inheritedWarningCounts }
  const infoCounts: Record<string, number> = {}
  const coverageReducedCounts: Record<string, number> = {}
  const errorCounts: Record<string, number> = {}
  for (const [code, count] of Object.entries(inheritedWarningCounts)) {
    const severity = fogDiagnosticSeverity(code)
    if (severity === "info") incrementDiagnosticCount(infoCounts, code, count)
    else if (severity === "coverage_reduced") {
      incrementDiagnosticCount(coverageReducedCounts, code, count)
    } else incrementDiagnosticCount(errorCounts, code, count)
  }
  let fallbackCount = geometryFallbackCount
  let vertexCount = 0
  const collectionPrefixBytes = textByteLength(
    '{"type":"FeatureCollection","features":['
  )
  const collectionSuffixBytes = textByteLength("]}")
  let serializedBytes = collectionPrefixBytes + collectionSuffixBytes

  for (
    let sourceIndex = 0;
    sourceIndex < inputFogData.features.length;
    sourceIndex += 1
  ) {
    const sourceFeature = inputFogData.features[sourceIndex]
    let normalized: PolygonFeature
    try {
      normalized = simplifyFogForEmission(sourceFeature as PolygonFeature)
    } catch {
      fallbackCount += 1
      recordValidationFailure(
        warningExamples,
        warningCounts,
        coverageReducedCounts,
        errorCounts,
        sourceIndex,
        "emission_simplification_failed"
      )
      continue
    }
    const validation = validateFogRenderFeature(
      normalized,
      { allowInteriorRings: true },
      sourceIndex
    )
    if (!validation.ok) {
      fallbackCount += 1
      for (const issue of validation.issues) {
        recordValidationFailure(
          warningExamples,
          warningCounts,
          coverageReducedCounts,
          errorCounts,
          sourceIndex,
          issue.code
        )
      }
      continue
    }

    if (accepted.length >= FOG_OUTPUT_DEFAULTS.maxFeatures) {
      fallbackCount += 1
      recordValidationFailure(
        warningExamples,
        warningCounts,
        coverageReducedCounts,
        errorCounts,
        sourceIndex,
        "feature_budget_exceeded"
      )
      continue
    }
    if (
      vertexCount + validation.vertexCount >
      FOG_OUTPUT_DEFAULTS.maxVertices
    ) {
      fallbackCount += 1
      recordValidationFailure(
        warningExamples,
        warningCounts,
        coverageReducedCounts,
        errorCounts,
        sourceIndex,
        "vertex_budget_exceeded"
      )
      continue
    }
    const featureBytes = serializedByteLength(normalized)
    const candidateBytes =
      serializedBytes +
      (accepted.length > 0 ? textByteLength(",") : 0) +
      featureBytes
    if (candidateBytes > FOG_OUTPUT_DEFAULTS.maxBytes) {
      fallbackCount += 1
      recordValidationFailure(
        warningExamples,
        warningCounts,
        coverageReducedCounts,
        errorCounts,
        sourceIndex,
        "serialized_byte_budget_exceeded"
      )
      continue
    }
    accepted.push({ feature: normalized, sourceIndex })
    vertexCount += validation.vertexCount
    serializedBytes = candidateBytes
  }

  const fogData: FogRenderData = featureCollection(
    accepted.map(({ feature }) => feature)
  )
  const finalValidation = validateFogRenderData(fogData, {
    allowInteriorRings: true,
  })
  if (!finalValidation.ok) {
    // The feature-local checks above should make this unreachable except for a
    // collection-level safety gate. Keep the safe subset and report the exact
    // gate instead of replacing unrelated explored features with full fog.
    for (const issue of finalValidation.issues) {
      const code = issue.code
      incrementDiagnosticCount(warningCounts, code)
      incrementDiagnosticCount(coverageReducedCounts, code)
      if (fogDiagnosticSeverity(code) === "error") {
        incrementDiagnosticCount(errorCounts, code)
      }
      addExample(
        warningExamples,
        `explored output retained only a validated subset after ${code.replaceAll("_", " ")}`
      )
    }
    degraded = true
  }
  if (fallbackCount > geometryFallbackCount) {
    incrementDiagnosticCount(
      warningCounts,
      "geometry-fallback",
      fallbackCount - geometryFallbackCount
    )
    incrementDiagnosticCount(
      coverageReducedCounts,
      "geometry-fallback",
      fallbackCount - geometryFallbackCount
    )
  }
  const outputDegraded = degraded || fallbackCount > 0
  return {
    fogData,
    degraded: outputDegraded,
    warnings: warningExamples,
    warningCounts,
    infoCounts,
    coverageReducedCounts,
    errorCounts,
    geometryFallbackCount: fallbackCount,
    partitionCount: 0,
    featureCount: finalValidation.featureCount,
    vertexCount: finalValidation.vertexCount,
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
    warningCounts: {},
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
  incoming: PolygonFeature,
  unionOperation: FillUnionOperation
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
  let normalizedProjectedMerged: PolygonFeature
  try {
    const projectedMerged = unionOperation(featureCollection(candidates))
    if (!projectedMerged) throw new Error("union returned no geometry")
    normalizedProjectedMerged = stripInteriorRings(projectedMerged)
    // The render validator expects geographic coordinates, not the normalized
    // Web Mercator coordinates used by the accumulator.
    const geographicMergedForValidation = unprojectFeature(
      normalizedProjectedMerged
    )
    const mergedValidation = validateFogRenderFeature(
      geographicMergedForValidation,
      {
        allowInteriorRings: true,
      }
    )
    if (!mergedValidation.ok) {
      throw new Error("union produced geometry that could not be validated")
    }
  } catch {
    // Retain the already-published positive components and isolate the new
    // difficult geometry. Future appends remain incremental but stop trying to
    // merge every component after one deterministic union failure.
    accumulator.degraded = true
    accumulator.projectedMasks.push(incoming)
    accumulator.fillComponents = []
    accumulator.fillComponentsByPartition.clear()
    accumulator.dirtyPartitions = new Set()
    addExample(
      accumulator.warnings,
      "explored-mask union failed; affected masks remain as separate explored regions"
    )
    incrementDiagnosticCount(
      accumulator.warningCounts,
      "explored-mask-union-failed"
    )
    return
  }

  for (const component of components) {
    removeFillComponent(accumulator, component)
  }
  addFillComponent(accumulator, normalizedProjectedMerged)
}

/**
 * Add one activity's masks to the accumulator. Corridor mode appends positive
 * masks directly. Fill mode uses a coarse spatial index so a disjoint append
 * does not re-union the entire library; only intersecting positive components
 * become dirty and are merged.
 */
export function appendFogMasks(
  accumulator: FogMaskAccumulator,
  masks: FogMask[],
  unionOperation: FillUnionOperation = union
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
    appendFillMask(accumulator, incoming, unionOperation)
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
  return aggregationResult(
    fogData,
    accumulator.degraded,
    accumulator.warnings,
    0,
    accumulator.warningCounts
  )
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
