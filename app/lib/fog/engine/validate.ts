import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"

const MAX_RENDER_LATITUDE = 85.05112878

export type FogRenderGeometry = Polygon | MultiPolygon
export type FogRenderData = FeatureCollection<FogRenderGeometry>

export const FOG_OUTPUT_DEFAULTS = {
  maxFeatures: 50_000,
  maxVertices: 500_000,
  maxBytes: 8_000_000,
  // A ring with roughly 700 segments reaches this budget before the
  // quadratic segment-pair scan can become an unbounded worker task.
  maxIntersectionChecks: 250_000,
} as const

export interface FogValidationOptions {
  maxFeatures?: number
  maxVertices?: number
  maxBytes?: number
  /** Maximum non-adjacent segment-pair checks permitted for one ring. */
  maxIntersectionChecks?: number
  /** Positive explored masks may contain holes (for example an unvisited loop). */
  allowInteriorRings?: boolean
}

export interface FogValidationReport {
  ok: boolean
  errors: string[]
  featureCount: number
  vertexCount: number
  byteLength: number
}

function isFiniteCoordinate(position: unknown): position is [number, number] {
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
  first: [number, number],
  second: [number, number],
  third: [number, number]
): number {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  )
}

function onSegment(
  first: [number, number],
  point: [number, number],
  second: [number, number]
): boolean {
  return (
    Math.min(first[0], second[0]) <= point[0] &&
    point[0] <= Math.max(first[0], second[0]) &&
    Math.min(first[1], second[1]) <= point[1] &&
    point[1] <= Math.max(first[1], second[1])
  )
}

function segmentsIntersect(
  firstStart: [number, number],
  firstEnd: [number, number],
  secondStart: [number, number],
  secondEnd: [number, number]
): boolean {
  const first = orientation(firstStart, firstEnd, secondStart)
  const second = orientation(firstStart, firstEnd, secondEnd)
  const third = orientation(secondStart, secondEnd, firstStart)
  const fourth = orientation(secondStart, secondEnd, firstEnd)
  const epsilon = 1e-12
  if (
    ((first > epsilon && second < -epsilon) ||
      (first < -epsilon && second > epsilon)) &&
    ((third > epsilon && fourth < -epsilon) ||
      (third < -epsilon && fourth > epsilon))
  ) {
    return true
  }
  return (
    (Math.abs(first) <= epsilon &&
      onSegment(firstStart, secondStart, firstEnd)) ||
    (Math.abs(second) <= epsilon &&
      onSegment(firstStart, secondEnd, firstEnd)) ||
    (Math.abs(third) <= epsilon &&
      onSegment(secondStart, firstStart, secondEnd)) ||
    (Math.abs(fourth) <= epsilon && onSegment(secondStart, firstEnd, secondEnd))
  )
}

type RingCheckResult = "simple" | "self-intersects" | "budget-exceeded"

function ringIsSimple(
  ring: [number, number][],
  maxIntersectionChecks: number
): RingCheckResult {
  const segmentCount = ring.length - 1
  let intersectionChecks = 0
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      if (second === first + 1) continue
      if (first === 0 && second === segmentCount - 1) continue
      if (intersectionChecks >= maxIntersectionChecks) {
        return "budget-exceeded"
      }
      intersectionChecks += 1
      if (
        segmentsIntersect(
          ring[first]!,
          ring[first + 1]!,
          ring[second]!,
          ring[second + 1]!
        )
      ) {
        return "self-intersects"
      }
    }
  }
  return "simple"
}

function ringArea(ring: [number, number][]): number {
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const first = ring[index]!
    const second = ring[index + 1]!
    area += first[0] * second[1] - second[0] * first[1]
  }
  return area / 2
}

function validateRing(
  ring: unknown,
  featureIndex: number,
  ringIndex: number,
  errors: string[],
  maxIntersectionChecks: number
): number {
  if (!Array.isArray(ring) || ring.length < 4) {
    errors.push(`feature ${featureIndex} ring ${ringIndex} is undersized`)
    return 0
  }
  const points = ring.filter(isFiniteCoordinate)
  if (points.length !== ring.length) {
    errors.push(
      `feature ${featureIndex} ring ${ringIndex} has invalid coordinates`
    )
    return points.length
  }
  if (
    points[0]![0] !== points[points.length - 1]![0] ||
    points[0]![1] !== points[points.length - 1]![1]
  ) {
    errors.push(`feature ${featureIndex} ring ${ringIndex} is not closed`)
  }
  if (Math.abs(ringArea(points)) <= 1e-14) {
    errors.push(`feature ${featureIndex} ring ${ringIndex} has zero area`)
  }
  const ringCheck = ringIsSimple(points, maxIntersectionChecks)
  if (ringCheck === "budget-exceeded") {
    errors.push(
      `feature ${featureIndex} ring ${ringIndex} self-intersection check exceeded its technical budget`
    )
  } else if (ringCheck === "self-intersects") {
    errors.push(`feature ${featureIndex} ring ${ringIndex} self-intersects`)
  }
  return points.length
}

function validateGeometry(
  geometry: FogRenderGeometry,
  featureIndex: number,
  errors: string[],
  maxIntersectionChecks: number,
  allowInteriorRings: boolean
): number {
  let vertices = 0
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : []
  if (polygons.length === 0) {
    errors.push(`feature ${featureIndex} has an unsupported geometry`)
    return 0
  }
  for (const polygon of polygons) {
    if (polygon.length !== 1 && !allowInteriorRings) {
      errors.push(
        `feature ${featureIndex} contains interior rings; bounded fog output must be hole-free`
      )
    }
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      vertices += validateRing(
        polygon[ringIndex],
        featureIndex,
        ringIndex,
        errors,
        maxIntersectionChecks
      )
    }
  }
  return vertices
}

export function validateFogRenderData(
  data: unknown,
  suppliedOptions: FogValidationOptions = {}
): FogValidationReport {
  const options = { ...FOG_OUTPUT_DEFAULTS, ...suppliedOptions }
  const maxIntersectionChecks =
    Number.isSafeInteger(options.maxIntersectionChecks) &&
    options.maxIntersectionChecks >= 0
      ? options.maxIntersectionChecks
      : FOG_OUTPUT_DEFAULTS.maxIntersectionChecks
  const allowInteriorRings = options.allowInteriorRings ?? true
  const errors: string[] = []
  if (
    !data ||
    typeof data !== "object" ||
    (data as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((data as { features?: unknown }).features)
  ) {
    return {
      ok: false,
      errors: ["fog output must be a FeatureCollection"],
      featureCount: 0,
      vertexCount: 0,
      byteLength: 0,
    }
  }

  const collection = data as FeatureCollection<FogRenderGeometry>
  let vertexCount = 0
  for (let index = 0; index < collection.features.length; index += 1) {
    const feature = collection.features[index] as Feature<FogRenderGeometry>
    if (!feature || feature.type !== "Feature" || !feature.geometry) {
      errors.push(`feature ${index} is missing geometry`)
      continue
    }
    vertexCount += validateGeometry(
      feature.geometry,
      index,
      errors,
      maxIntersectionChecks,
      allowInteriorRings
    )
  }
  let byteLength = 0
  try {
    byteLength = JSON.stringify(data).length
  } catch {
    errors.push("fog output cannot be serialized")
  }
  if (collection.features.length > options.maxFeatures) {
    errors.push("fog output exceeds the feature budget")
  }
  if (vertexCount > options.maxVertices) {
    errors.push("fog output exceeds the vertex budget")
  }
  if (byteLength > options.maxBytes) {
    errors.push("fog output exceeds the serialized byte budget")
  }
  return {
    ok: errors.length === 0,
    errors,
    featureCount: collection.features.length,
    vertexCount,
    byteLength,
  }
}
