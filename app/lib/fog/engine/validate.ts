import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"

const MAX_RENDER_LATITUDE = 85.05112878
const TOPOLOGY_EPSILON = 1e-12

export type FogRenderGeometry = Polygon | MultiPolygon
export type FogRenderData = FeatureCollection<FogRenderGeometry>

export const FOG_OUTPUT_DEFAULTS = {
  maxFeatures: 50_000,
  maxVertices: 500_000,
  maxBytes: 8_000_000,
  // This remains an absolute safety gate. The spatially indexed scan below
  // normally examines only overlapping segment boxes, so valid large rings
  // no longer hit the old quadratic ceiling merely because they have many
  // vertices.
  maxIntersectionChecks: 250_000,
} as const

export type FogValidationStatus =
  | "valid"
  | "invalid"
  | "budget_exceeded"
  | "cancelled"

export interface FogValidationIssue {
  code: string
  message: string
  featureIndex?: number
  ringIndex?: number
}

export interface FogValidationOptions {
  maxFeatures?: number
  maxVertices?: number
  maxBytes?: number
  /** Maximum plausible segment-pair checks permitted for one relation. */
  maxIntersectionChecks?: number
  /** Positive explored masks may contain holes (for example an unvisited loop). */
  allowInteriorRings?: boolean
  /** Optional synchronous cancellation checkpoint for large topology scans. */
  shouldCancel?: () => boolean
}

export interface FogValidationReport {
  ok: boolean
  status: FogValidationStatus
  errors: string[]
  issues: FogValidationIssue[]
  /** Stable issue-code totals for callers that must not parse messages. */
  errorCodes: Record<string, number>
  featureCount: number
  vertexCount: number
  byteLength: number
}

type Coordinate = [number, number]

interface Segment {
  index: number
  start: Coordinate
  end: Coordinate
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface ValidationCollector {
  issues: FogValidationIssue[]
  cancelled: boolean
}

function addIssue(
  collector: ValidationCollector,
  code: string,
  message: string,
  featureIndex?: number,
  ringIndex?: number
): void {
  collector.issues.push({
    code,
    message,
    ...(featureIndex === undefined ? {} : { featureIndex }),
    ...(ringIndex === undefined ? {} : { ringIndex }),
  })
}

function isFiniteCoordinate(position: unknown): position is Coordinate {
  return (
    Array.isArray(position) &&
    position.length >= 2 &&
    typeof position[0] === "number" &&
    typeof position[1] === "number" &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    position[0] >= -180 &&
    position[0] <= 180 &&
    position[1] >= -MAX_RENDER_LATITUDE &&
    position[1] <= MAX_RENDER_LATITUDE
  )
}

function orientation(
  first: Coordinate,
  second: Coordinate,
  third: Coordinate
): number {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  )
}

function onSegment(
  first: Coordinate,
  point: Coordinate,
  second: Coordinate
): boolean {
  return (
    point[0] >= Math.min(first[0], second[0]) - TOPOLOGY_EPSILON &&
    point[0] <= Math.max(first[0], second[0]) + TOPOLOGY_EPSILON &&
    point[1] >= Math.min(first[1], second[1]) - TOPOLOGY_EPSILON &&
    point[1] <= Math.max(first[1], second[1]) + TOPOLOGY_EPSILON
  )
}

function segmentsIntersect(
  firstStart: Coordinate,
  firstEnd: Coordinate,
  secondStart: Coordinate,
  secondEnd: Coordinate
): boolean {
  const first = orientation(firstStart, firstEnd, secondStart)
  const second = orientation(firstStart, firstEnd, secondEnd)
  const third = orientation(secondStart, secondEnd, firstStart)
  const fourth = orientation(secondStart, secondEnd, firstEnd)
  if (
    ((first > TOPOLOGY_EPSILON && second < -TOPOLOGY_EPSILON) ||
      (first < -TOPOLOGY_EPSILON && second > TOPOLOGY_EPSILON)) &&
    ((third > TOPOLOGY_EPSILON && fourth < -TOPOLOGY_EPSILON) ||
      (third < -TOPOLOGY_EPSILON && fourth > TOPOLOGY_EPSILON))
  ) {
    return true
  }
  return (
    (Math.abs(first) <= TOPOLOGY_EPSILON &&
      onSegment(firstStart, secondStart, firstEnd)) ||
    (Math.abs(second) <= TOPOLOGY_EPSILON &&
      onSegment(firstStart, secondEnd, firstEnd)) ||
    (Math.abs(third) <= TOPOLOGY_EPSILON &&
      onSegment(secondStart, firstStart, secondEnd)) ||
    (Math.abs(fourth) <= TOPOLOGY_EPSILON &&
      onSegment(secondStart, firstEnd, secondEnd))
  )
}

function makeSegments(ring: Coordinate[]): Segment[] {
  const segments: Segment[] = []
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index]!
    const end = ring[index + 1]!
    segments.push({
      index,
      start,
      end,
      minX: Math.min(start[0], end[0]),
      maxX: Math.max(start[0], end[0]),
      minY: Math.min(start[1], end[1]),
      maxY: Math.max(start[1], end[1]),
    })
  }
  return segments
}

function boxesOverlap(first: Segment, second: Segment): boolean {
  return !(
    first.maxX < second.minX - TOPOLOGY_EPSILON ||
    first.minX > second.maxX + TOPOLOGY_EPSILON ||
    first.maxY < second.minY - TOPOLOGY_EPSILON ||
    first.minY > second.maxY + TOPOLOGY_EPSILON
  )
}

function segmentsAreAdjacent(
  first: number,
  second: number,
  segmentCount: number
): boolean {
  return second === first + 1 || (first === 0 && second === segmentCount - 1)
}

export type FogRingCheckResult =
  | "simple"
  | "self-intersects"
  | "budget-exceeded"
  | "cancelled"

/**
 * Sweep segment bounding boxes from west to east before doing exact tests.
 * This is conservative: every pair whose boxes can intersect is examined,
 * including touching and collinear candidates, while disjoint boxes are never
 * sent through the expensive orientation test.
 */
export function ringIsSimple(
  ring: Coordinate[],
  maxIntersectionChecks: number,
  shouldCancel?: () => boolean
): FogRingCheckResult {
  const segmentCount = ring.length - 1
  if (segmentCount < 4) return "simple"
  // Preserve the explicit zero-budget behavior used by diagnostics/tests. A
  // ring with non-adjacent relationships cannot be certified with no checks.
  if (maxIntersectionChecks === 0) return "budget-exceeded"

  const segments = makeSegments(ring).sort(
    (first, second) => first.minX - second.minX || first.minY - second.minY
  )
  const active: Segment[] = []
  let intersectionChecks = 0

  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    if (shouldCancel?.()) return "cancelled"
    const current = segments[segmentIndex]!
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index]!.maxX < current.minX - TOPOLOGY_EPSILON) {
        active.splice(index, 1)
      }
    }
    for (
      let candidateIndex = 0;
      candidateIndex < active.length;
      candidateIndex += 1
    ) {
      if (candidateIndex % 1024 === 0 && shouldCancel?.()) {
        return "cancelled"
      }
      const candidate = active[candidateIndex]!
      const first = Math.min(candidate.index, current.index)
      const second = Math.max(candidate.index, current.index)
      if (segmentsAreAdjacent(first, second, segmentCount)) continue
      if (!boxesOverlap(candidate, current)) continue
      if (intersectionChecks >= maxIntersectionChecks) {
        return "budget-exceeded"
      }
      intersectionChecks += 1
      if (
        segmentsIntersect(
          candidate.start,
          candidate.end,
          current.start,
          current.end
        )
      ) {
        return "self-intersects"
      }
    }
    active.push(current)
  }
  return "simple"
}

type RingPairCheckResult =
  | "disjoint"
  | "intersects"
  | "budget-exceeded"
  | "cancelled"

function ringsIntersect(
  firstRing: Coordinate[],
  secondRing: Coordinate[],
  maxIntersectionChecks: number,
  shouldCancel?: () => boolean
): RingPairCheckResult {
  let checks = 0
  const first = makeSegments(firstRing)
  const second = makeSegments(secondRing)
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    if (shouldCancel?.()) return "cancelled"
    const firstSegment = first[firstIndex]!
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      if (secondIndex % 1024 === 0 && shouldCancel?.()) return "cancelled"
      const secondSegment = second[secondIndex]!
      if (!boxesOverlap(firstSegment, secondSegment)) continue
      if (checks >= maxIntersectionChecks) return "budget-exceeded"
      checks += 1
      if (
        segmentsIntersect(
          firstSegment.start,
          firstSegment.end,
          secondSegment.start,
          secondSegment.end
        )
      ) {
        return "intersects"
      }
    }
  }
  return "disjoint"
}

function ringArea(ring: Coordinate[]): number {
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const first = ring[index]!
    const second = ring[index + 1]!
    area += first[0] * second[1] - second[0] * first[1]
  }
  return area / 2
}

function ringPointKey(point: Coordinate): string {
  return `${point[0]}:${point[1]}`
}

interface ValidatedRing {
  points: Coordinate[]
  structurallyValid: boolean
}

function validateRing(
  ring: unknown,
  featureIndex: number,
  ringIndex: number,
  collector: ValidationCollector,
  maxIntersectionChecks: number,
  shouldCancel?: () => boolean
): ValidatedRing {
  if (!Array.isArray(ring) || ring.length < 4) {
    addIssue(
      collector,
      "ring_undersized",
      `feature ${featureIndex} ring ${ringIndex} is undersized`,
      featureIndex,
      ringIndex
    )
    return { points: [], structurallyValid: false }
  }
  const points = ring.filter(isFiniteCoordinate)
  let structurallyValid = true
  if (points.length !== ring.length) {
    addIssue(
      collector,
      "invalid_coordinates",
      `feature ${featureIndex} ring ${ringIndex} has invalid coordinates`,
      featureIndex,
      ringIndex
    )
    structurallyValid = false
  }
  if (points.length < 4) return { points, structurallyValid: false }

  if (
    points[0]![0] !== points[points.length - 1]![0] ||
    points[0]![1] !== points[points.length - 1]![1]
  ) {
    addIssue(
      collector,
      "ring_not_closed",
      `feature ${featureIndex} ring ${ringIndex} is not closed`,
      featureIndex,
      ringIndex
    )
    structurallyValid = false
  }
  if (Math.abs(ringArea(points)) <= 1e-14) {
    addIssue(
      collector,
      "ring_zero_area",
      `feature ${featureIndex} ring ${ringIndex} has zero area`,
      featureIndex,
      ringIndex
    )
    structurallyValid = false
  }

  const segmentCount = points.length - 1
  const vertices = new Map<string, number>()
  for (let index = 0; index < segmentCount; index += 1) {
    const point = points[index]!
    const next = points[index + 1]!
    if (point[0] === next[0] && point[1] === next[1]) {
      addIssue(
        collector,
        "consecutive_duplicate_vertex",
        `feature ${featureIndex} ring ${ringIndex} contains a zero-length segment`,
        featureIndex,
        ringIndex
      )
      structurallyValid = false
    }
    const key = ringPointKey(point)
    if (vertices.has(key)) {
      addIssue(
        collector,
        "repeated_vertex",
        `feature ${featureIndex} ring ${ringIndex} contains a repeated vertex`,
        featureIndex,
        ringIndex
      )
      structurallyValid = false
    } else {
      vertices.set(key, index)
    }
  }

  const ringCheck = ringIsSimple(points, maxIntersectionChecks, shouldCancel)
  if (ringCheck === "budget-exceeded") {
    addIssue(
      collector,
      "validation_budget_exceeded",
      `feature ${featureIndex} ring ${ringIndex} self-intersection check exceeded its technical budget`,
      featureIndex,
      ringIndex
    )
  } else if (ringCheck === "self-intersects") {
    addIssue(
      collector,
      "ring_self_intersects",
      `feature ${featureIndex} ring ${ringIndex} self-intersects`,
      featureIndex,
      ringIndex
    )
    structurallyValid = false
  } else if (ringCheck === "cancelled") {
    addIssue(
      collector,
      "validation_cancelled",
      `feature ${featureIndex} ring ${ringIndex} validation was cancelled`,
      featureIndex,
      ringIndex
    )
    collector.cancelled = true
  }
  return { points, structurallyValid }
}

type PointLocation = "inside" | "boundary" | "outside"

function pointLocation(point: Coordinate, ring: Coordinate[]): PointLocation {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const current = ring[index]!
    const prior = ring[previous]!
    if (
      onSegment(prior, point, current) &&
      Math.abs(orientation(prior, current, point)) <= TOPOLOGY_EPSILON
    ) {
      return "boundary"
    }
    const crosses =
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) /
          (prior[1] - current[1]) +
          current[0]
    if (crosses) inside = !inside
  }
  return inside ? "inside" : "outside"
}

function validateGeometry(
  geometry: FogRenderGeometry,
  featureIndex: number,
  collector: ValidationCollector,
  maxIntersectionChecks: number,
  allowInteriorRings: boolean,
  shouldCancel?: () => boolean
): number {
  let vertices = 0
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : []
  if (polygons.length === 0) {
    addIssue(
      collector,
      "unsupported_geometry",
      `feature ${featureIndex} has an unsupported geometry`,
      featureIndex
    )
    return 0
  }

  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) {
      addIssue(
        collector,
        "invalid_polygon",
        `feature ${featureIndex} has invalid polygon coordinates`,
        featureIndex
      )
      continue
    }
    if (polygon.length !== 1 && !allowInteriorRings) {
      addIssue(
        collector,
        "interior_rings_disallowed",
        `feature ${featureIndex} contains interior rings; bounded fog output must be hole-free`,
        featureIndex
      )
    }
    const rings = polygon.map((ring, ringIndex) =>
      validateRing(
        ring,
        featureIndex,
        ringIndex,
        collector,
        maxIntersectionChecks,
        shouldCancel
      )
    )
    for (const ring of rings) vertices += ring.points.length
    const outer = rings[0]
    if (!outer?.structurallyValid || outer.points.length < 4) continue

    for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
      const hole = rings[ringIndex]!
      if (!hole.structurallyValid || hole.points.length < 4) continue
      const location = pointLocation(hole.points[0]!, outer.points)
      if (location === "boundary") {
        addIssue(
          collector,
          "hole_touches_shell",
          `feature ${featureIndex} hole ${ringIndex} touches its shell`,
          featureIndex,
          ringIndex
        )
      } else if (location === "outside") {
        addIssue(
          collector,
          "hole_outside_shell",
          `feature ${featureIndex} hole ${ringIndex} is outside its shell`,
          featureIndex,
          ringIndex
        )
      }
      const shellRelation = ringsIntersect(
        outer.points,
        hole.points,
        maxIntersectionChecks,
        shouldCancel
      )
      if (shellRelation === "budget-exceeded") {
        addIssue(
          collector,
          "validation_budget_exceeded",
          `feature ${featureIndex} hole ${ringIndex} topology check exceeded its technical budget`,
          featureIndex,
          ringIndex
        )
      } else if (shellRelation === "intersects") {
        addIssue(
          collector,
          "hole_touches_shell",
          `feature ${featureIndex} hole ${ringIndex} intersects its shell`,
          featureIndex,
          ringIndex
        )
      } else if (shellRelation === "cancelled") {
        addIssue(
          collector,
          "validation_cancelled",
          `feature ${featureIndex} hole ${ringIndex} validation was cancelled`,
          featureIndex,
          ringIndex
        )
        collector.cancelled = true
      }
      for (let otherIndex = 1; otherIndex < ringIndex; otherIndex += 1) {
        const otherHole = rings[otherIndex]!
        if (!otherHole.structurallyValid || otherHole.points.length < 4)
          continue
        const holeRelation = ringsIntersect(
          otherHole.points,
          hole.points,
          maxIntersectionChecks,
          shouldCancel
        )
        if (holeRelation === "budget-exceeded") {
          addIssue(
            collector,
            "validation_budget_exceeded",
            `feature ${featureIndex} holes ${otherIndex} and ${ringIndex} topology check exceeded its technical budget`,
            featureIndex,
            ringIndex
          )
        } else if (holeRelation === "intersects") {
          addIssue(
            collector,
            "holes_overlap",
            `feature ${featureIndex} holes ${otherIndex} and ${ringIndex} overlap`,
            featureIndex,
            ringIndex
          )
        } else if (holeRelation === "cancelled") {
          addIssue(
            collector,
            "validation_cancelled",
            `feature ${featureIndex} hole ${ringIndex} validation was cancelled`,
            featureIndex,
            ringIndex
          )
          collector.cancelled = true
          break
        }
      }
      if (collector.cancelled) break
    }
    if (collector.cancelled) break
  }
  return vertices
}

function safeLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback
}

function serializedByteLength(value: unknown): {
  byteLength: number
  failed: boolean
} {
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== "string") return { byteLength: 0, failed: true }
    if (typeof TextEncoder !== "undefined") {
      return {
        byteLength: new TextEncoder().encode(serialized).byteLength,
        failed: false,
      }
    }
    return { byteLength: serialized.length, failed: false }
  } catch {
    return { byteLength: 0, failed: true }
  }
}

function makeReport(
  issues: FogValidationIssue[],
  featureCount: number,
  vertexCount: number,
  byteLength: number,
  cancelled = false
): FogValidationReport {
  const errorCodes: Record<string, number> = {}
  for (const issue of issues) {
    errorCodes[issue.code] = (errorCodes[issue.code] ?? 0) + 1
  }
  const hasNonBudgetIssue = issues.some(
    ({ code }) => !code.endsWith("_budget_exceeded")
  )
  const status: FogValidationStatus = cancelled
    ? "cancelled"
    : issues.length === 0
      ? "valid"
      : hasNonBudgetIssue
        ? "invalid"
        : "budget_exceeded"
  return {
    ok: issues.length === 0,
    status,
    errors: issues.map(({ message }) => message),
    issues,
    errorCodes,
    featureCount,
    vertexCount,
    byteLength,
  }
}

function validationOptions(suppliedOptions: FogValidationOptions) {
  return {
    maxFeatures: safeLimit(
      suppliedOptions.maxFeatures,
      FOG_OUTPUT_DEFAULTS.maxFeatures
    ),
    maxVertices: safeLimit(
      suppliedOptions.maxVertices,
      FOG_OUTPUT_DEFAULTS.maxVertices
    ),
    maxBytes: safeLimit(suppliedOptions.maxBytes, FOG_OUTPUT_DEFAULTS.maxBytes),
    maxIntersectionChecks: safeLimit(
      suppliedOptions.maxIntersectionChecks,
      FOG_OUTPUT_DEFAULTS.maxIntersectionChecks
    ),
    allowInteriorRings: suppliedOptions.allowInteriorRings ?? true,
    shouldCancel: suppliedOptions.shouldCancel,
  }
}

/** Validate one output feature without imposing collection-level budgets. */
export function validateFogRenderFeature(
  value: unknown,
  suppliedOptions: FogValidationOptions = {},
  featureIndex = 0
): FogValidationReport {
  const options = validationOptions(suppliedOptions)
  const collector: ValidationCollector = { issues: [], cancelled: false }
  if (!value || typeof value !== "object") {
    addIssue(
      collector,
      "invalid_feature",
      `feature ${featureIndex} is invalid`,
      featureIndex
    )
    return makeReport(collector.issues, 0, 0, 0, collector.cancelled)
  }
  const feature = value as Partial<Feature<FogRenderGeometry>>
  if (feature.type !== "Feature" || !feature.geometry) {
    addIssue(
      collector,
      "missing_geometry",
      `feature ${featureIndex} is missing geometry`,
      featureIndex
    )
    return makeReport(collector.issues, 1, 0, 0, collector.cancelled)
  }
  const vertexCount = validateGeometry(
    feature.geometry,
    featureIndex,
    collector,
    options.maxIntersectionChecks,
    options.allowInteriorRings,
    options.shouldCancel
  )
  const serialized = serializedByteLength(value)
  if (serialized.failed) {
    addIssue(
      collector,
      "serialization_failed",
      "fog output cannot be serialized",
      featureIndex
    )
  }
  if (vertexCount > options.maxVertices) {
    addIssue(
      collector,
      "vertex_budget_exceeded",
      "fog output exceeds the vertex budget",
      featureIndex
    )
  }
  if (serialized.byteLength > options.maxBytes) {
    addIssue(
      collector,
      "serialized_byte_budget_exceeded",
      "fog output exceeds the serialized byte budget",
      featureIndex
    )
  }
  return makeReport(
    collector.issues,
    1,
    vertexCount,
    serialized.byteLength,
    collector.cancelled
  )
}

export function validateFogRenderData(
  data: unknown,
  suppliedOptions: FogValidationOptions = {}
): FogValidationReport {
  const options = validationOptions(suppliedOptions)
  const collector: ValidationCollector = { issues: [], cancelled: false }
  if (
    !data ||
    typeof data !== "object" ||
    (data as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((data as { features?: unknown }).features)
  ) {
    addIssue(
      collector,
      "invalid_feature_collection",
      "fog output must be a FeatureCollection"
    )
    return makeReport(collector.issues, 0, 0, 0, collector.cancelled)
  }

  const collection = data as FeatureCollection<FogRenderGeometry>
  let vertexCount = 0
  for (let index = 0; index < collection.features.length; index += 1) {
    if (options.shouldCancel?.()) {
      addIssue(
        collector,
        "validation_cancelled",
        "fog output validation was cancelled"
      )
      collector.cancelled = true
      break
    }
    const feature = collection.features[
      index
    ] as Feature<FogRenderGeometry> | null
    if (!feature || feature.type !== "Feature" || !feature.geometry) {
      addIssue(
        collector,
        "missing_geometry",
        `feature ${index} is missing geometry`,
        index
      )
      continue
    }
    vertexCount += validateGeometry(
      feature.geometry,
      index,
      collector,
      options.maxIntersectionChecks,
      options.allowInteriorRings,
      options.shouldCancel
    )
    if (collector.cancelled) break
  }
  const serialized = serializedByteLength(data)
  if (serialized.failed) {
    addIssue(
      collector,
      "serialization_failed",
      "fog output cannot be serialized"
    )
  }
  if (collection.features.length > options.maxFeatures) {
    addIssue(
      collector,
      "feature_budget_exceeded",
      "fog output exceeds the feature budget"
    )
  }
  if (vertexCount > options.maxVertices) {
    addIssue(
      collector,
      "vertex_budget_exceeded",
      "fog output exceeds the vertex budget"
    )
  }
  if (serialized.byteLength > options.maxBytes) {
    addIssue(
      collector,
      "serialized_byte_budget_exceeded",
      "fog output exceeds the serialized byte budget"
    )
  }
  return makeReport(
    collector.issues,
    collection.features.length,
    vertexCount,
    serialized.byteLength,
    collector.cancelled
  )
}
