import type { ActivityType, RawPoint } from "~shared/activities"
import {
  ABSOLUTE_TELEPORT_DISTANCE_M,
  ANOMALY_ALGORITHM_VERSION,
  MAX_ANOMALY_EXAMPLES,
  MIN_SPEED_TEST_DISTANCE_M,
  NO_TIMESTAMP_REJOIN_RADIUS_M,
  REJOIN_CONFIRMATION_EDGES,
  REJOIN_POSITION_MARGIN_M,
  SPATIAL_FALLBACK_WINDOW_EDGES,
  TRUSTED_PREFIX_MIN_POINTS,
  TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES,
  maxPlausibleSpeed,
  spatialFallbackDistanceM,
} from "~/constants/activityAnomalies"
import { haversineMeters } from "~/lib/geo"

export interface AnomalyPoint extends RawPoint {
  /** Index in the original source path before any cleaning. */
  sourcePointIndex: number
  /** Optional FIT corroboration; v1 decisions do not depend on it. */
  recordedSpeedMps?: number
  /** Optional FIT corroboration; v1 decisions do not depend on it. */
  gpsAccuracyM?: number
}

export interface AnomalySourcePath {
  sourcePathIndex: number
  points: AnomalyPoint[]
}

export type GpsAnomalyCode =
  | "teleport_spike"
  | "teleport_excursion"
  | "teleport_tail"
  | "ambiguous_discontinuity"
  | "dropped_short_path"

export interface GpsAnomalyExample {
  code: GpsAnomalyCode
  sourcePathIndex: number
  startPointIndex: number
  endPointIndex: number
  entryDistanceM: number
  entryDeltaMs: number | null
  entrySpeedMps: number | null
  rejoinPointIndex: number | null
  rejoinDistanceFromLastTrustedM: number | null
  rejoinElapsedMs: number | null
}

export interface GpsAnomalyResult {
  status: "clean" | "cleaned" | "ambiguous" | "rejected"
  paths: AnomalyPoint[][]
  counts: {
    inputPoints: number
    retainedPoints: number
    removedPoints: number
    splitCount: number
    trimmedPrefixPoints: number
    trimmedSuffixPoints: number
    reasons: Partial<Record<GpsAnomalyCode, number>>
  }
  examples: GpsAnomalyExample[]
  work: {
    distanceCalculations: number
    pointsVisited: number
  }
}

export interface GpsAnomalyOptions {
  activityType?: ActivityType
}

interface Edge {
  distanceM: number
  deltaMs: number | null
  speedMps: number | null
}

interface Candidate {
  edge: Edge
  reason: "speed" | "absolute" | "spatial"
}

interface MutableCounts {
  inputPoints: number
  splitCount: number
  trimmedPrefixPoints: number
  trimmedSuffixPoints: number
  reasons: Partial<Record<GpsAnomalyCode, number>>
}

interface MutableWork {
  distanceCalculations: number
  pointsVisited: number
}

interface AnalysisContext {
  activityType: ActivityType | undefined
  maxSpeedMps: number
  spatialEdges: number[]
  work: MutableWork
}

function isUsablePoint(point: AnomalyPoint): boolean {
  return (
    Number.isFinite(point.lng) &&
    Number.isFinite(point.lat) &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    point.lat >= -90 &&
    point.lat <= 90
  )
}

function addReason(
  counts: Pick<MutableCounts, "reasons">,
  code: GpsAnomalyCode,
  amount = 1
): void {
  counts.reasons[code] = (counts.reasons[code] ?? 0) + amount
}

function finiteTimestamp(point: AnomalyPoint): number | null {
  return point.timestampMs != null && Number.isFinite(point.timestampMs)
    ? point.timestampMs
    : null
}

function edgeBetween(
  first: AnomalyPoint,
  second: AnomalyPoint,
  work: MutableWork
): Edge {
  work.distanceCalculations += 1
  const distanceM = haversineMeters(
    [first.lng, first.lat],
    [second.lng, second.lat]
  )
  const firstTimestamp = finiteTimestamp(first)
  const secondTimestamp = finiteTimestamp(second)
  const rawDeltaMs =
    firstTimestamp != null && secondTimestamp != null
      ? secondTimestamp - firstTimestamp
      : null
  const deltaMs = rawDeltaMs != null && rawDeltaMs > 0 ? rawDeltaMs : null
  return {
    distanceM,
    deltaMs,
    speedMps: deltaMs == null ? null : distanceM / (deltaMs / 1_000),
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function spatialFallbackDistance(context: AnalysisContext): number {
  return spatialFallbackDistanceM(median(context.spatialEdges) ?? 0)
}

function candidateForEdge(
  edge: Edge,
  context: AnalysisContext
): Candidate | null {
  // A timestamped edge is physically plausible when its speed is below the
  // generous activity ceiling, even if it spans a large distance. The hard
  // distance threshold is deliberately the timestamp-free fallback.
  if (edge.deltaMs != null) {
    if (
      edge.distanceM >= MIN_SPEED_TEST_DISTANCE_M &&
      edge.speedMps != null &&
      edge.speedMps > context.maxSpeedMps
    ) {
      return { edge, reason: "speed" }
    }
    return null
  }
  if (edge.distanceM >= ABSOLUTE_TELEPORT_DISTANCE_M) {
    return { edge, reason: "absolute" }
  }
  if (edge.distanceM > spatialFallbackDistance(context)) {
    return { edge, reason: "spatial" }
  }
  return null
}

function isPhysicallyPlausible(edge: Edge, context: AnalysisContext): boolean {
  if (edge.deltaMs != null && edge.speedMps != null) {
    return edge.speedMps <= context.maxSpeedMps
  }
  return (
    edge.distanceM < ABSOLUTE_TELEPORT_DISTANCE_M &&
    edge.distanceM <= spatialFallbackDistance(context)
  )
}

function addTrustedSpatialEdge(context: AnalysisContext, edge: Edge): void {
  if (edge.distanceM <= 0) return
  context.spatialEdges.push(edge.distanceM)
  if (context.spatialEdges.length > SPATIAL_FALLBACK_WINDOW_EDGES) {
    context.spatialEdges.shift()
  }
}

function reachableFromTrusted(
  lastTrusted: AnomalyPoint,
  possibleReturn: AnomalyPoint,
  context: AnalysisContext
): { distanceM: number; elapsedMs: number | null; reachable: boolean } {
  context.work.distanceCalculations += 1
  const distanceM = haversineMeters(
    [lastTrusted.lng, lastTrusted.lat],
    [possibleReturn.lng, possibleReturn.lat]
  )
  const lastTimestamp = finiteTimestamp(lastTrusted)
  const returnTimestamp = finiteTimestamp(possibleReturn)
  const rawElapsedMs =
    lastTimestamp != null && returnTimestamp != null
      ? returnTimestamp - lastTimestamp
      : null
  if (rawElapsedMs != null && rawElapsedMs > 0) {
    const reachableDistanceM = Math.max(
      REJOIN_POSITION_MARGIN_M,
      context.maxSpeedMps * (rawElapsedMs / 1_000)
    )
    return {
      distanceM,
      elapsedMs: rawElapsedMs,
      reachable: distanceM <= reachableDistanceM,
    }
  }
  return {
    distanceM,
    elapsedMs: null,
    reachable: distanceM <= NO_TIMESTAMP_REJOIN_RADIUS_M,
  }
}

function exampleForRemoval(
  code: GpsAnomalyCode,
  sourcePathIndex: number,
  points: AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  entry: Edge,
  rejoinPointIndex: number | null,
  rejoin: { distanceM: number; elapsedMs: number | null } | null
): GpsAnomalyExample {
  const entryDeltaMs = entry.deltaMs
  return {
    code,
    sourcePathIndex,
    startPointIndex: points[startIndex]?.sourcePointIndex ?? startIndex,
    endPointIndex: points[endIndex]?.sourcePointIndex ?? endIndex,
    entryDistanceM: entry.distanceM,
    entryDeltaMs,
    entrySpeedMps: entry.speedMps,
    rejoinPointIndex:
      rejoinPointIndex == null
        ? null
        : (points[rejoinPointIndex]?.sourcePointIndex ?? rejoinPointIndex),
    rejoinDistanceFromLastTrustedM: rejoin?.distanceM ?? null,
    rejoinElapsedMs: rejoin?.elapsedMs ?? null,
  }
}

interface PieceResult {
  paths: AnomalyPoint[][]
  examples: GpsAnomalyExample[]
  counts: Omit<MutableCounts, "inputPoints">
  ambiguous: boolean
  structuralDrop: boolean
}

function analyzePiece(
  sourcePathIndex: number,
  points: AnomalyPoint[],
  context: AnalysisContext
): PieceResult {
  const counts: Omit<MutableCounts, "inputPoints"> = {
    splitCount: 0,
    trimmedPrefixPoints: 0,
    trimmedSuffixPoints: 0,
    reasons: {},
  }
  if (points.length < 2) {
    addReason(counts, "dropped_short_path")
    return {
      paths: [],
      examples: [],
      counts,
      ambiguous: false,
      structuralDrop: true,
    }
  }

  const outputPaths: AnomalyPoint[][] = []
  const examples: GpsAnomalyExample[] = []
  let currentPath: AnomalyPoint[] = [points[0]!]
  let trusted = false
  let plausibleEdges = 0
  const preTrustSpatialEdges: number[] = []
  let quarantineStart = -1
  let lastTrustedIndex = -1
  let entryEdge: Edge | null = null
  let ambiguous = false

  const flushCurrentPath = () => {
    if (currentPath.length >= 2) outputPaths.push(currentPath)
    else if (currentPath.length === 1) {
      addReason(counts, "dropped_short_path")
    }
  }

  let index = 1
  while (index < points.length) {
    if (quarantineStart === -1) {
      const edge = edgeBetween(points[index - 1]!, points[index]!, context.work)
      const candidate = candidateForEdge(edge, context)
      if (candidate) {
        if (!trusted) {
          if (currentPath.length >= 2) outputPaths.push(currentPath)
          addReason(counts, "ambiguous_discontinuity")
          collectExample(
            examples,
            exampleForRemoval(
              "ambiguous_discontinuity",
              sourcePathIndex,
              points,
              index,
              points.length - 1,
              candidate.edge,
              null,
              null
            )
          )
          ambiguous = true
          break
        }
        flushCurrentPath()
        quarantineStart = index
        lastTrustedIndex = index - 1
        entryEdge = candidate.edge
        index += 1
        continue
      }

      currentPath.push(points[index]!)
      if (trusted) addTrustedSpatialEdge(context, edge)
      else {
        plausibleEdges += 1
        if (edge.distanceM > 0) preTrustSpatialEdges.push(edge.distanceM)
      }
      if (
        !trusted &&
        currentPath.length >= TRUSTED_PREFIX_MIN_POINTS &&
        plausibleEdges >= TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES
      ) {
        trusted = true
        // Use only the bounded, already-plausible prefix to seed the fallback.
        context.spatialEdges.push(
          ...preTrustSpatialEdges.slice(-SPATIAL_FALLBACK_WINDOW_EDGES)
        )
      }
      index += 1
      continue
    }

    // The first quarantined point was already classified by the entry edge.
    // Every later candidate is a possible snap-back boundary. Short or zero
    // distance edges remain quarantined and never update the trusted baseline.
    const edge = edgeBetween(points[index - 1]!, points[index]!, context.work)
    const candidate = candidateForEdge(edge, context)
    if (candidate) {
      const rejoin = reachableFromTrusted(
        points[lastTrustedIndex]!,
        points[index]!,
        context
      )
      const hasConfirmationWindow =
        index + REJOIN_CONFIRMATION_EDGES < points.length
      let confirmed = rejoin.reachable && hasConfirmationWindow
      if (confirmed) {
        for (
          let lookahead = index;
          lookahead < index + REJOIN_CONFIRMATION_EDGES;
          lookahead += 1
        ) {
          const confirmationEdge = edgeBetween(
            points[lookahead]!,
            points[lookahead + 1]!,
            context.work
          )
          if (!isPhysicallyPlausible(confirmationEdge, context)) {
            confirmed = false
            break
          }
        }
      }
      if (confirmed) {
        const removedStart = quarantineStart
        const removedEnd = index - 1
        const removedCount = removedEnd - removedStart + 1
        const code: GpsAnomalyCode =
          removedCount === 1 ? "teleport_spike" : "teleport_excursion"
        addReason(counts, code)
        counts.splitCount += 1
        const example = exampleForRemoval(
          code,
          sourcePathIndex,
          points,
          removedStart,
          removedEnd,
          entryEdge!,
          index,
          rejoin
        )
        currentPath = [points[index]!]
        quarantineStart = -1
        lastTrustedIndex = -1
        entryEdge = null
        index += 1
        // The return point is now the first point of a trusted path. Its
        // following edges will re-enter the normal trusted loop and update the
        // frozen spatial scale only after that point is accepted.
        if (currentPath.length >= TRUSTED_PREFIX_MIN_POINTS) trusted = true
        collectExample(examples, example)
        continue
      }
    }
    index += 1
  }

  if (ambiguous) {
    return {
      paths: outputPaths,
      examples,
      counts,
      ambiguous: true,
      structuralDrop: false,
    }
  }

  if (quarantineStart !== -1) {
    const removedCount = points.length - quarantineStart
    addReason(counts, "teleport_tail")
    counts.trimmedSuffixPoints += removedCount
    return {
      paths: outputPaths,
      examples: entryEdge
        ? [
            ...examples,
            exampleForRemoval(
              "teleport_tail",
              sourcePathIndex,
              points,
              quarantineStart,
              points.length - 1,
              entryEdge,
              null,
              null
            ),
          ].slice(0, MAX_ANOMALY_EXAMPLES)
        : examples,
      counts,
      ambiguous: false,
      structuralDrop: false,
    }
  }

  flushCurrentPath()
  return {
    paths: outputPaths,
    examples,
    counts,
    ambiguous: false,
    structuralDrop: false,
  }
}

// This small mutable collector keeps the hot path allocation-free while
// retaining exact counts and a bounded diagnostic example list.
function collectExample(
  examples: GpsAnomalyExample[],
  example: GpsAnomalyExample
): void {
  if (examples.length < MAX_ANOMALY_EXAMPLES) examples.push(example)
}

function mergeCounts(
  target: MutableCounts,
  source: PieceResult["counts"]
): void {
  target.splitCount += source.splitCount
  target.trimmedPrefixPoints += source.trimmedPrefixPoints
  target.trimmedSuffixPoints += source.trimmedSuffixPoints
  for (const [code, count] of Object.entries(source.reasons) as Array<
    [GpsAnomalyCode, number]
  >) {
    target.reasons[code] = (target.reasons[code] ?? 0) + count
  }
}

function validPieces(source: AnomalySourcePath): {
  pieces: AnomalyPoint[][]
  hadInvalidPoint: boolean
} {
  const pieces: AnomalyPoint[][] = []
  let current: AnomalyPoint[] = []
  let hadInvalidPoint = false
  const flush = () => {
    if (current.length > 0) pieces.push(current)
    current = []
  }
  for (const point of source.points) {
    if (!isUsablePoint(point)) {
      hadInvalidPoint = true
      flush()
      continue
    }
    current.push(point)
  }
  flush()
  return { pieces, hadInvalidPoint }
}

/**
 * Clean each source path independently. The result only contains raw points;
 * parsers remain responsible for converting retained points into canonical
 * geometry and aligned timestamp arrays.
 */
export function detectGpsAnomalies(
  sourcePaths: readonly AnomalySourcePath[],
  options: GpsAnomalyOptions = {}
): GpsAnomalyResult {
  const context: AnalysisContext = {
    activityType: options.activityType,
    maxSpeedMps: maxPlausibleSpeed(options.activityType),
    spatialEdges: [],
    work: { distanceCalculations: 0, pointsVisited: 0 },
  }
  const counts: MutableCounts = {
    inputPoints: sourcePaths.reduce(
      (total, source) => total + source.points.length,
      0
    ),
    splitCount: 0,
    trimmedPrefixPoints: 0,
    trimmedSuffixPoints: 0,
    reasons: {},
  }
  const paths: AnomalyPoint[][] = []
  const examples: GpsAnomalyExample[] = []
  let ambiguous = false
  let structuralDrop = false

  for (const source of sourcePaths) {
    context.work.pointsVisited += source.points.length
    const { pieces, hadInvalidPoint } = validPieces(source)
    structuralDrop ||= hadInvalidPoint
    for (const piece of pieces) {
      const result = analyzePiece(source.sourcePathIndex, piece, {
        ...context,
        spatialEdges: [],
      })
      mergeCounts(counts, result.counts)
      structuralDrop ||= result.structuralDrop
      ambiguous ||= result.ambiguous
      paths.push(...result.paths)
      for (const example of result.examples) collectExample(examples, example)
    }
  }

  const retainedPoints = paths.reduce((total, path) => total + path.length, 0)
  counts.reasons = Object.fromEntries(
    Object.entries(counts.reasons).filter(([, count]) => count > 0)
  ) as Partial<Record<GpsAnomalyCode, number>>
  const removedPoints = Math.max(0, counts.inputPoints - retainedPoints)
  const hasAnomaly =
    (counts.reasons.teleport_spike ?? 0) > 0 ||
    (counts.reasons.teleport_excursion ?? 0) > 0 ||
    (counts.reasons.teleport_tail ?? 0) > 0
  const status: GpsAnomalyResult["status"] = ambiguous
    ? "ambiguous"
    : paths.length === 0
      ? "rejected"
      : hasAnomaly || structuralDrop || removedPoints > 0
        ? "cleaned"
        : "clean"

  return {
    status,
    paths,
    counts: {
      inputPoints: counts.inputPoints,
      retainedPoints,
      removedPoints,
      splitCount: counts.splitCount,
      trimmedPrefixPoints: counts.trimmedPrefixPoints,
      trimmedSuffixPoints: counts.trimmedSuffixPoints,
      reasons: counts.reasons,
    },
    examples,
    work: context.work,
  }
}

/** Descriptive alias for callers that treat the module as an import cleaner. */
export const cleanGpsAnomalies = detectGpsAnomalies

export { ANOMALY_ALGORITHM_VERSION }
