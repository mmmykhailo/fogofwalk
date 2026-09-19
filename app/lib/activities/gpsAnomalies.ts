import type { ActivityType, RawPoint } from "~shared/activities"
import {
  ABSOLUTE_TELEPORT_DISTANCE_M,
  ANOMALY_ALGORITHM_VERSION,
  GPS_ACCURACY_MULTIPLIER,
  LOCAL_DISTANCE_CEILING_M,
  LOCAL_DISTANCE_FLOOR_M,
  LOCAL_DISTANCE_MULTIPLIER,
  MAX_RELIABILITY_EXAMPLES,
  MAX_TRUSTED_GPS_ACCURACY_M,
  MIN_CONFIDENT_FRAGMENT_POINTS,
  MIN_RETAINED_PATH_POINTS,
  PAUSE_DRIFT_MAX_MEDIAN_SPEED_MPS,
  PAUSE_DRIFT_MAX_NET_DISTANCE_M,
  PAUSE_DRIFT_MAX_RADIUS_M,
  PAUSE_DRIFT_MAX_WINDOW_POINTS,
  PAUSE_DRIFT_MIN_DURATION_MS,
  PAUSE_DRIFT_MIN_PATH_DISTANCE_M,
  PAUSE_DRIFT_PATH_TO_NET_RATIO,
  REJOIN_CONFIRMATION_EDGES,
  REJOIN_DISTANCE_MULTIPLIER,
  REJOIN_POSITION_CEILING_M,
  REJOIN_POSITION_FLOOR_M,
  RELIABILITY_MIN_BASELINE_EDGES,
  RELIABILITY_WINDOW_EDGES,
  SPEED_TEST_DISTANCE_FLOOR_M,
  TIME_GAP_CEILING_MS,
  TIME_GAP_MULTIPLIER,
  TIME_GAP_FLOOR_MS,
  clampReliabilityDistance,
  clampReliabilityTimeGap,
  maxPlausibleSpeed,
} from "~/constants/activityAnomalies"
import { haversineMeters } from "~/lib/geo"

export interface AnomalyPoint extends RawPoint {
  /** Index in the original source path before any cleaning. */
  sourcePointIndex: number
  /** Optional FIT corroboration used only for pause evidence. */
  recordedSpeedMps?: number
  /** Optional FIT fix uncertainty used by the reliability classifier. */
  gpsAccuracyM?: number
}

export interface AnomalySourcePath {
  sourcePathIndex: number
  points: AnomalyPoint[]
}

export type GpsAnomalyCode =
  | "invalid_coordinate"
  | "untrusted_accuracy"
  | "non_positive_time"
  | "recording_gap"
  | "impossible_speed"
  | "local_distance_jump"
  | "hard_teleport"
  | "local_spike"
  | "local_excursion"
  | "pause_drift"
  | "untrusted_prefix"
  | "untrusted_suffix"
  | "dropped_short_path"

export type GpsAnomalyOperation = "split" | "remove"

export interface GpsAnomalyExample {
  code: GpsAnomalyCode
  operation: GpsAnomalyOperation
  /** Edge or evidence code that caused a removal quarantine, when applicable. */
  triggerCode?: GpsAnomalyCode
  sourcePathIndex: number
  startPointIndex: number
  endPointIndex: number
  removedPointCount: number
  entryDistanceM: number
  entryDeltaMs: number | null
  entrySpeedMps: number | null
  distanceLimitM: number
  effectiveDistanceLimitM: number
  timeGapLimitMs: number
  rejoinLimitM: number | null
  trustedDistanceSamples: number
  trustedTimeSamples: number
  rejoinPointIndex: number | null
  rejoinDistanceFromLastTrustedM: number | null
  rejoinElapsedMs: number | null
}

export interface GpsAnomalyResult {
  status: "clean" | "cleaned" | "rejected"
  paths: AnomalyPoint[][]
  counts: {
    inputPoints: number
    retainedPoints: number
    removedPoints: number
    emittedPathCount: number
    splitCount: number
    gapSplitCount: number
    removalSplitCount: number
    trimmedPrefixPoints: number
    trimmedSuffixPoints: number
    reasons: Partial<Record<GpsAnomalyCode, number>>
  }
  examples: GpsAnomalyExample[]
  work: {
    distanceCalculations: number
    pointsVisited: number
    boundedLookaheadCount: number
    maxDistanceWindowSize: number
    maxTimeWindowSize: number
    pauseWindowPointsVisited: number
  }
}

export interface GpsAnomalyOptions {
  activityType?: ActivityType
}

interface EdgeEvidence {
  distanceM: number
  rawDeltaMs: number | null
  deltaMs: number | null
  speedMps: number | null
  firstAccuracyM: number | null
  secondAccuracyM: number | null
  distanceLimitM: number
  effectiveDistanceLimitM: number
  timeGapLimitMs: number
  trustedDistanceSamples: number
  trustedTimeSamples: number
  reason: GpsAnomalyCode | null
}

interface RollingBaseline {
  distances: number[]
  deltas: number[]
}

interface MutableWork {
  distanceCalculations: number
  pointsVisited: number
  boundedLookaheadCount: number
  maxDistanceWindowSize: number
  maxTimeWindowSize: number
  pauseWindowPointsVisited: number
}

interface AnalysisContext {
  maxSpeedMps: number
  work: MutableWork
}

interface MutableCounts {
  inputPoints: number
  splitCount: number
  gapSplitCount: number
  removalSplitCount: number
  trimmedPrefixPoints: number
  trimmedSuffixPoints: number
  reasons: Partial<Record<GpsAnomalyCode, number>>
}

interface EmittedPath {
  sourcePathIndex: number
  points: AnomalyPoint[]
}

interface Quarantine {
  startIndex: number
  lastTrustedIndex: number
  entry: EdgeEvidence
  triggerCode: GpsAnomalyCode
}

interface RejoinEvidence {
  distanceM: number
  elapsedMs: number | null
  rejoinLimitM: number
  reachable: boolean
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

function finiteTimestamp(point: AnomalyPoint): number | null {
  return point.timestampMs != null && Number.isFinite(point.timestampMs)
    ? point.timestampMs
    : null
}

function finiteAccuracy(point: AnomalyPoint): number | null {
  return point.gpsAccuracyM != null &&
    Number.isFinite(point.gpsAccuracyM) &&
    point.gpsAccuracyM >= 0
    ? point.gpsAccuracyM
    : null
}

function isUntrustedAccuracy(point: AnomalyPoint): boolean {
  const accuracy = finiteAccuracy(point)
  return accuracy != null && accuracy > MAX_TRUSTED_GPS_ACCURACY_M
}

function addReason(
  counts: Pick<MutableCounts, "reasons">,
  code: GpsAnomalyCode,
  amount = 1
): void {
  counts.reasons[code] = (counts.reasons[code] ?? 0) + amount
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function edgeDistance(
  first: AnomalyPoint,
  second: AnomalyPoint,
  work: MutableWork
): { distanceM: number; rawDeltaMs: number | null } {
  work.distanceCalculations += 1
  const distanceM = haversineMeters(
    [first.lng, first.lat],
    [second.lng, second.lat]
  )
  const firstTimestamp = finiteTimestamp(first)
  const secondTimestamp = finiteTimestamp(second)
  return {
    distanceM,
    rawDeltaMs:
      firstTimestamp != null && secondTimestamp != null
        ? secondTimestamp - firstTimestamp
        : null,
  }
}

function derivedLimits(baseline: RollingBaseline): {
  distanceLimitM: number
  timeGapLimitMs: number
} {
  const distanceMedian = median(baseline.distances)
  const timeMedian = median(baseline.deltas)
  return {
    distanceLimitM:
      baseline.distances.length < RELIABILITY_MIN_BASELINE_EDGES ||
      distanceMedian == null
        ? LOCAL_DISTANCE_CEILING_M
        : clampReliabilityDistance(distanceMedian * LOCAL_DISTANCE_MULTIPLIER),
    timeGapLimitMs:
      baseline.deltas.length < RELIABILITY_MIN_BASELINE_EDGES ||
      timeMedian == null
        ? TIME_GAP_CEILING_MS
        : clampReliabilityTimeGap(timeMedian * TIME_GAP_MULTIPLIER),
  }
}

function classifyEdge(
  first: AnomalyPoint,
  second: AnomalyPoint,
  baseline: RollingBaseline,
  context: AnalysisContext
): EdgeEvidence {
  const { distanceM, rawDeltaMs } = edgeDistance(first, second, context.work)
  const deltaMs = rawDeltaMs != null && rawDeltaMs > 0 ? rawDeltaMs : null
  const speedMps = deltaMs == null ? null : distanceM / (deltaMs / 1_000)
  const firstAccuracyM = finiteAccuracy(first)
  const secondAccuracyM = finiteAccuracy(second)
  const { distanceLimitM, timeGapLimitMs } = derivedLimits(baseline)
  const knownAccuracy = [firstAccuracyM, secondAccuracyM].filter(
    (value): value is number =>
      value != null && value <= MAX_TRUSTED_GPS_ACCURACY_M
  )
  const accuracyAllowance =
    knownAccuracy.length > 0
      ? GPS_ACCURACY_MULTIPLIER * Math.max(...knownAccuracy)
      : null
  const effectiveDistanceLimitM = Math.min(
    LOCAL_DISTANCE_CEILING_M,
    Math.max(distanceLimitM, accuracyAllowance ?? 0)
  )

  let reason: GpsAnomalyCode | null = null
  if (
    (firstAccuracyM != null && firstAccuracyM > MAX_TRUSTED_GPS_ACCURACY_M) ||
    (secondAccuracyM != null && secondAccuracyM > MAX_TRUSTED_GPS_ACCURACY_M)
  ) {
    reason = "untrusted_accuracy"
  } else if (rawDeltaMs != null && rawDeltaMs <= 0) {
    reason = "non_positive_time"
  } else if (deltaMs != null && deltaMs > timeGapLimitMs) {
    reason = "recording_gap"
  } else if (distanceM >= ABSOLUTE_TELEPORT_DISTANCE_M) {
    reason = "hard_teleport"
  } else if (
    deltaMs != null &&
    distanceM >= SPEED_TEST_DISTANCE_FLOOR_M &&
    speedMps != null &&
    speedMps > context.maxSpeedMps
  ) {
    reason = "impossible_speed"
  } else if (distanceM > effectiveDistanceLimitM) {
    reason = "local_distance_jump"
  }

  return {
    distanceM,
    rawDeltaMs,
    deltaMs,
    speedMps,
    firstAccuracyM,
    secondAccuracyM,
    distanceLimitM,
    effectiveDistanceLimitM,
    timeGapLimitMs,
    trustedDistanceSamples: baseline.distances.length,
    trustedTimeSamples: baseline.deltas.length,
    reason,
  }
}

function updateWindowWork(baseline: RollingBaseline, work: MutableWork): void {
  work.maxDistanceWindowSize = Math.max(
    work.maxDistanceWindowSize,
    baseline.distances.length
  )
  work.maxTimeWindowSize = Math.max(
    work.maxTimeWindowSize,
    baseline.deltas.length
  )
}

function appendBaseline(
  baseline: RollingBaseline,
  edge: EdgeEvidence,
  work: MutableWork
): void {
  if (edge.distanceM > 0) {
    baseline.distances.push(edge.distanceM)
    if (baseline.distances.length > RELIABILITY_WINDOW_EDGES) {
      baseline.distances.shift()
    }
  }
  if (edge.deltaMs != null && edge.deltaMs > 0) {
    baseline.deltas.push(edge.deltaMs)
    if (baseline.deltas.length > RELIABILITY_WINDOW_EDGES) {
      baseline.deltas.shift()
    }
  }
  updateWindowWork(baseline, work)
}

function seedBaseline(
  points: readonly AnomalyPoint[],
  startIndex: number,
  baseline: RollingBaseline,
  context: AnalysisContext
): void {
  baseline.distances.length = 0
  baseline.deltas.length = 0
  const end = Math.min(points.length - 1, startIndex + RELIABILITY_WINDOW_EDGES)
  for (let index = startIndex; index < end; index += 1) {
    const first = points[index]!
    const second = points[index + 1]!
    const measured = edgeDistance(first, second, context.work)
    const firstAccuracy = finiteAccuracy(first)
    const secondAccuracy = finiteAccuracy(second)
    if (
      (firstAccuracy != null && firstAccuracy > MAX_TRUSTED_GPS_ACCURACY_M) ||
      (secondAccuracy != null && secondAccuracy > MAX_TRUSTED_GPS_ACCURACY_M)
    ) {
      continue
    }
    if (measured.distanceM >= ABSOLUTE_TELEPORT_DISTANCE_M) continue
    if (measured.distanceM <= 0 && measured.rawDeltaMs == null) continue
    if (measured.rawDeltaMs != null) {
      if (
        measured.rawDeltaMs <= 0 ||
        measured.rawDeltaMs > TIME_GAP_CEILING_MS
      ) {
        continue
      }
      const speedMps = measured.distanceM / (measured.rawDeltaMs / 1_000)
      if (
        measured.distanceM >= SPEED_TEST_DISTANCE_FLOOR_M &&
        speedMps > context.maxSpeedMps
      ) {
        continue
      }
    }
    if (measured.distanceM > 0) baseline.distances.push(measured.distanceM)
    if (measured.rawDeltaMs != null && measured.rawDeltaMs > 0) {
      baseline.deltas.push(measured.rawDeltaMs)
    }
  }
  if (baseline.distances.length > RELIABILITY_WINDOW_EDGES) {
    baseline.distances.splice(
      0,
      baseline.distances.length - RELIABILITY_WINDOW_EDGES
    )
  }
  if (baseline.deltas.length > RELIABILITY_WINDOW_EDGES) {
    baseline.deltas.splice(0, baseline.deltas.length - RELIABILITY_WINDOW_EDGES)
  }
  updateWindowWork(baseline, context.work)
}

function collectExample(
  examples: GpsAnomalyExample[],
  example: GpsAnomalyExample
): void {
  if (examples.length < MAX_RELIABILITY_EXAMPLES) examples.push(example)
}

function evidenceForPoint(
  baseline: RollingBaseline,
  context: AnalysisContext
): EdgeEvidence {
  const { distanceLimitM, timeGapLimitMs } = derivedLimits(baseline)
  return {
    distanceM: 0,
    rawDeltaMs: null,
    deltaMs: null,
    speedMps: null,
    firstAccuracyM: null,
    secondAccuracyM: null,
    distanceLimitM,
    effectiveDistanceLimitM: distanceLimitM,
    timeGapLimitMs,
    trustedDistanceSamples: baseline.distances.length,
    trustedTimeSamples: baseline.deltas.length,
    reason: null,
  }
}

function makeExample(
  code: GpsAnomalyCode,
  operation: GpsAnomalyOperation,
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  entry: EdgeEvidence,
  context: AnalysisContext,
  options: {
    triggerCode?: GpsAnomalyCode
    removedPointCount?: number
    rejoinPointIndex?: number | null
    rejoin?: RejoinEvidence | null
  } = {}
): GpsAnomalyExample {
  const rejoinPointIndex = options.rejoinPointIndex ?? null
  return {
    code,
    operation,
    ...(options.triggerCode ? { triggerCode: options.triggerCode } : {}),
    sourcePathIndex,
    startPointIndex:
      points[Math.max(0, startIndex)]?.sourcePointIndex ?? startIndex,
    endPointIndex: points[Math.max(0, endIndex)]?.sourcePointIndex ?? endIndex,
    removedPointCount:
      options.removedPointCount ??
      (operation === "remove" ? Math.max(0, endIndex - startIndex + 1) : 0),
    entryDistanceM: entry.distanceM,
    entryDeltaMs: entry.rawDeltaMs,
    entrySpeedMps: entry.speedMps,
    distanceLimitM: entry.distanceLimitM,
    effectiveDistanceLimitM: entry.effectiveDistanceLimitM,
    timeGapLimitMs: entry.timeGapLimitMs,
    rejoinLimitM: options.rejoin?.rejoinLimitM ?? null,
    trustedDistanceSamples: entry.trustedDistanceSamples,
    trustedTimeSamples: entry.trustedTimeSamples,
    rejoinPointIndex:
      rejoinPointIndex == null
        ? null
        : (points[rejoinPointIndex]?.sourcePointIndex ?? rejoinPointIndex),
    rejoinDistanceFromLastTrustedM: options.rejoin?.distanceM ?? null,
    rejoinElapsedMs: options.rejoin?.elapsedMs ?? null,
  }
}

function addPrefixRemoval(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  entry: EdgeEvidence,
  context: AnalysisContext,
  triggerCode?: GpsAnomalyCode
): void {
  if (endIndex < startIndex) return
  const removedPointCount = endIndex - startIndex + 1
  addReason(counts, "untrusted_prefix")
  counts.trimmedPrefixPoints += removedPointCount
  collectExample(
    examples,
    makeExample(
      "untrusted_prefix",
      "remove",
      sourcePathIndex,
      points,
      startIndex,
      endIndex,
      entry,
      context,
      { triggerCode, removedPointCount }
    )
  )
}

function addSuffixRemoval(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  quarantine: Quarantine,
  context: AnalysisContext
): void {
  const removedPointCount = points.length - quarantine.startIndex
  if (removedPointCount <= 0) return
  addReason(counts, "untrusted_suffix")
  counts.trimmedSuffixPoints += removedPointCount
  collectExample(
    examples,
    makeExample(
      "untrusted_suffix",
      "remove",
      sourcePathIndex,
      points,
      quarantine.startIndex,
      points.length - 1,
      quarantine.entry,
      context,
      {
        triggerCode: quarantine.triggerCode,
        removedPointCount,
      }
    )
  )
}

function addBoundarySplit(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  code: "recording_gap" | "non_positive_time",
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  edgeIndex: number,
  entry: EdgeEvidence,
  context: AnalysisContext
): void {
  addReason(counts, code)
  counts.splitCount += 1
  counts.gapSplitCount += code === "recording_gap" ? 1 : 0
  collectExample(
    examples,
    makeExample(
      code,
      "split",
      sourcePathIndex,
      points,
      edgeIndex,
      edgeIndex + 1,
      entry,
      context
    )
  )
}

function addRemovalSplit(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  code: "local_spike" | "local_excursion" | "untrusted_accuracy",
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  entry: EdgeEvidence,
  context: AnalysisContext,
  options: {
    triggerCode?: GpsAnomalyCode
    rejoinPointIndex?: number | null
    rejoin?: RejoinEvidence | null
  } = {}
): void {
  const removedPointCount = endIndex - startIndex + 1
  addReason(counts, code)
  counts.splitCount += 1
  counts.removalSplitCount += 1
  collectExample(
    examples,
    makeExample(
      code,
      "remove",
      sourcePathIndex,
      points,
      startIndex,
      endIndex,
      entry,
      context,
      {
        ...options,
        removedPointCount,
      }
    )
  )
}

function rejoinFromTrusted(
  lastTrusted: AnomalyPoint,
  possibleReturn: AnomalyPoint,
  quarantinedPointCount: number,
  baseline: RollingBaseline,
  context: AnalysisContext
): RejoinEvidence {
  const { distanceM } = edgeDistance(lastTrusted, possibleReturn, context.work)
  const trustedMedian = median(baseline.distances) ?? LOCAL_DISTANCE_FLOOR_M
  const rejoinLimitM = Math.min(
    REJOIN_POSITION_CEILING_M,
    Math.max(
      REJOIN_POSITION_FLOOR_M,
      trustedMedian * (quarantinedPointCount + 1) * REJOIN_DISTANCE_MULTIPLIER
    )
  )
  const lastTimestamp = finiteTimestamp(lastTrusted)
  const returnTimestamp = finiteTimestamp(possibleReturn)
  const elapsedMs =
    lastTimestamp != null && returnTimestamp != null
      ? returnTimestamp - lastTimestamp
      : null
  const bypassSpeedMps =
    elapsedMs != null && elapsedMs > 0 ? distanceM / (elapsedMs / 1_000) : null
  const timeCompatible =
    elapsedMs == null ||
    (elapsedMs > 0 &&
      bypassSpeedMps != null &&
      bypassSpeedMps <= context.maxSpeedMps)
  return {
    distanceM,
    elapsedMs,
    rejoinLimitM,
    reachable:
      distanceM <= rejoinLimitM &&
      timeCompatible &&
      !isUntrustedAccuracy(possibleReturn),
  }
}

function confirmRejoin(
  points: readonly AnomalyPoint[],
  index: number,
  baseline: RollingBaseline,
  context: AnalysisContext
): boolean {
  if (index + REJOIN_CONFIRMATION_EDGES >= points.length) return false
  for (let offset = 0; offset < REJOIN_CONFIRMATION_EDGES; offset += 1) {
    const edge = classifyEdge(
      points[index + offset]!,
      points[index + offset + 1]!,
      baseline,
      context
    )
    context.work.boundedLookaheadCount += 1
    if (edge.reason != null) return false
  }
  return true
}

function analyzeValidSegment(
  sourcePathIndex: number,
  points: AnomalyPoint[],
  context: AnalysisContext,
  counts: MutableCounts,
  examples: GpsAnomalyExample[]
): EmittedPath[] {
  if (points.length === 0) return []

  const baseline: RollingBaseline = { distances: [], deltas: [] }
  const output: EmittedPath[] = []
  let currentPath: AnomalyPoint[] = []
  let currentStartIndex = -1
  let needsConfidence = false
  let isConfident = false
  let quarantine: Quarantine | null = null

  const resetBaseline = (startIndex: number) => {
    seedBaseline(points, startIndex, baseline, context)
  }

  const startCandidate = (index: number, requireConfidence: boolean) => {
    currentPath = [points[index]!]
    currentStartIndex = index
    needsConfidence = requireConfidence
    isConfident = false
    resetBaseline(index)
  }

  const pushCurrent = (allowUnconfident = true) => {
    if (currentPath.length >= MIN_RETAINED_PATH_POINTS) {
      if (!needsConfidence || isConfident || allowUnconfident) {
        output.push({ sourcePathIndex, points: currentPath })
      } else {
        addPrefixRemoval(
          counts,
          examples,
          sourcePathIndex,
          points,
          currentStartIndex,
          currentStartIndex + currentPath.length - 1,
          evidenceForPoint(baseline, context),
          context
        )
      }
    } else if (currentPath.length > 0) {
      if (needsConfidence) {
        addPrefixRemoval(
          counts,
          examples,
          sourcePathIndex,
          points,
          currentStartIndex,
          currentStartIndex + currentPath.length - 1,
          evidenceForPoint(baseline, context),
          context
        )
      } else {
        addReason(counts, "dropped_short_path")
      }
    }
    currentPath = []
    currentStartIndex = -1
    needsConfidence = false
    isConfident = false
  }

  const dropCurrentAsPrefix = (
    entry: EdgeEvidence,
    triggerCode?: GpsAnomalyCode,
    includeEndIndex?: number
  ) => {
    if (currentPath.length > 0) {
      addPrefixRemoval(
        counts,
        examples,
        sourcePathIndex,
        points,
        currentStartIndex,
        includeEndIndex ?? currentStartIndex + currentPath.length - 1,
        entry,
        context,
        triggerCode
      )
    }
    currentPath = []
    currentStartIndex = -1
    isConfident = false
  }

  resetBaseline(0)
  let index = 0
  while (index < points.length) {
    if (quarantine) {
      const edge = classifyEdge(
        points[index - 1]!,
        points[index]!,
        baseline,
        context
      )
      if (
        edge.reason === "recording_gap" ||
        edge.reason === "non_positive_time"
      ) {
        pushCurrent()
        addSuffixRemoval(
          counts,
          examples,
          sourcePathIndex,
          points,
          quarantine,
          context
        )
        break
      }

      const rejoin = rejoinFromTrusted(
        points[quarantine.lastTrustedIndex]!,
        points[index]!,
        index - quarantine.startIndex,
        baseline,
        context
      )
      if (rejoin.reachable && confirmRejoin(points, index, baseline, context)) {
        const removedStart = quarantine.startIndex
        const removedEnd = index - 1
        const removedCount = removedEnd - removedStart + 1
        const code =
          quarantine.triggerCode === "untrusted_accuracy"
            ? "untrusted_accuracy"
            : removedCount === 1
              ? "local_spike"
              : "local_excursion"
        pushCurrent()
        addRemovalSplit(
          counts,
          examples,
          code,
          sourcePathIndex,
          points,
          removedStart,
          removedEnd,
          quarantine.entry,
          context,
          {
            triggerCode: quarantine.triggerCode,
            rejoinPointIndex: index,
            rejoin,
          }
        )
        quarantine = null
        startCandidate(index, true)
        index += 1
        continue
      }
      index += 1
      continue
    }

    if (currentPath.length === 0) {
      if (isUntrustedAccuracy(points[index]!)) {
        addPrefixRemoval(
          counts,
          examples,
          sourcePathIndex,
          points,
          index,
          index,
          evidenceForPoint(baseline, context),
          context,
          "untrusted_accuracy"
        )
        resetBaseline(index + 1)
        needsConfidence = true
        index += 1
        continue
      }
      startCandidate(index, needsConfidence)
      index += 1
      continue
    }

    const edge = classifyEdge(
      points[index - 1]!,
      points[index]!,
      baseline,
      context
    )

    if (edge.reason == null) {
      currentPath.push(points[index]!)
      appendBaseline(baseline, edge, context.work)
      if (currentPath.length >= MIN_CONFIDENT_FRAGMENT_POINTS) {
        isConfident = true
      }
      index += 1
      continue
    }

    if (
      edge.reason === "recording_gap" ||
      edge.reason === "non_positive_time"
    ) {
      if (needsConfidence && !isConfident) pushCurrent(false)
      else pushCurrent()
      addBoundarySplit(
        counts,
        examples,
        edge.reason,
        sourcePathIndex,
        points,
        index - 1,
        edge,
        context
      )
      startCandidate(index, false)
      index += 1
      continue
    }

    if (!isConfident) {
      if (edge.reason === "untrusted_accuracy") {
        dropCurrentAsPrefix(edge, edge.reason, index)
        needsConfidence = true
        resetBaseline(index + 1)
        index += 1
        continue
      }
      dropCurrentAsPrefix(edge, "untrusted_prefix")
      if (isUntrustedAccuracy(points[index]!)) {
        addPrefixRemoval(
          counts,
          examples,
          sourcePathIndex,
          points,
          index,
          index,
          edge,
          context,
          "untrusted_accuracy"
        )
        resetBaseline(index + 1)
        index += 1
        needsConfidence = true
        continue
      }
      startCandidate(index, true)
      index += 1
      continue
    }

    quarantine = {
      startIndex: index,
      lastTrustedIndex: index - 1,
      entry: edge,
      triggerCode: edge.reason,
    }
    index += 1
  }

  if (quarantine) {
    pushCurrent()
    addSuffixRemoval(
      counts,
      examples,
      sourcePathIndex,
      points,
      quarantine,
      context
    )
  } else if (currentPath.length > 0) {
    pushCurrent(needsConfidence ? isConfident : true)
  }

  return output
}

function addInvalidCoordinateRemoval(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  sourcePathIndex: number,
  invalidPoints: readonly AnomalyPoint[],
  baseline: RollingBaseline,
  context: AnalysisContext
): void {
  if (invalidPoints.length === 0) return
  addReason(counts, "invalid_coordinate")
  counts.splitCount += 1
  counts.removalSplitCount += 1
  const entry = evidenceForPoint(baseline, context)
  collectExample(
    examples,
    makeExample(
      "invalid_coordinate",
      "remove",
      sourcePathIndex,
      invalidPoints,
      0,
      invalidPoints.length - 1,
      entry,
      context,
      { removedPointCount: invalidPoints.length }
    )
  )
}

interface PauseWindowPoint {
  pointIndex: number
  point: AnomalyPoint
  unwrappedLng: number
  distanceM: number
  speedMps: number | null
}

interface NumericDequeEntry {
  pointIndex: number
  value: number
}

interface PauseRange {
  startIndex: number
  endIndex: number
}

function unwrapLongitude(previous: number, current: number): number {
  let result = current
  while (result - previous > 180) result -= 360
  while (result - previous < -180) result += 360
  return result
}

function addMonotonicEntry(
  queue: NumericDequeEntry[],
  entry: NumericDequeEntry,
  ascending: boolean
): void {
  while (queue.length > 0) {
    const last = queue[queue.length - 1]!
    if (ascending ? last.value <= entry.value : last.value >= entry.value) break
    queue.pop()
  }
  queue.push(entry)
}

function dropOldMonotonicEntries(
  queue: NumericDequeEntry[],
  firstPointIndex: number
): void {
  while (queue.length > 0 && queue[0]!.pointIndex < firstPointIndex) {
    queue.shift()
  }
}

function pauseWindowIsSpatiallySmall(
  window: readonly PauseWindowPoint[],
  windowStart: number,
  sumLng: number,
  sumLat: number,
  minLng: NumericDequeEntry,
  maxLng: NumericDequeEntry,
  minLat: NumericDequeEntry,
  maxLat: NumericDequeEntry
): boolean {
  const first = window[windowStart]!
  const last = window[window.length - 1]!
  const length = window.length - windowStart
  const meanLng = sumLng / length
  const meanLat = sumLat / length
  const longitudeMeters =
    111_195 * Math.max(0.01, Math.cos((meanLat * Math.PI) / 180))
  const radiusByLongitude = Math.max(
    Math.abs(maxLng.value - meanLng) * longitudeMeters,
    Math.abs(minLng.value - meanLng) * longitudeMeters
  )
  const radiusByLatitude = Math.max(
    Math.abs(maxLat.value - meanLat) * 111_195,
    Math.abs(minLat.value - meanLat) * 111_195
  )
  if (
    Math.max(radiusByLongitude, radiusByLatitude) > PAUSE_DRIFT_MAX_RADIUS_M
  ) {
    return false
  }
  return (
    haversineMeters(
      [first.point.lng, first.point.lat],
      [last.point.lng, last.point.lat]
    ) <= PAUSE_DRIFT_MAX_NET_DISTANCE_M
  )
}

function pauseRangeQualifies(
  path: readonly AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  context: AnalysisContext
): boolean {
  if (endIndex - startIndex < 2) return false
  const first = path[startIndex]!
  const last = path[endIndex]!
  const firstTimestamp = finiteTimestamp(first)
  const lastTimestamp = finiteTimestamp(last)
  if (
    firstTimestamp == null ||
    lastTimestamp == null ||
    lastTimestamp - firstTimestamp < PAUSE_DRIFT_MIN_DURATION_MS
  ) {
    return false
  }

  let sumLng = 0
  let sumLat = 0
  let unwrappedLng = first.lng
  let previousUnwrappedLng = first.lng
  let pathDistanceM = 0
  const speeds: number[] = []
  const recordedSpeeds: number[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const point = path[index]!
    if (finiteTimestamp(point) == null) return false
    if (index > startIndex) {
      unwrappedLng = unwrapLongitude(previousUnwrappedLng, point.lng)
      const previous = path[index - 1]!
      const measured = edgeDistance(previous, point, context.work)
      pathDistanceM += measured.distanceM
      if (measured.rawDeltaMs == null || measured.rawDeltaMs <= 0) return false
      speeds.push(measured.distanceM / (measured.rawDeltaMs / 1_000))
    }
    previousUnwrappedLng = unwrappedLng
    sumLng += unwrappedLng
    sumLat += point.lat
    const recordedSpeed = point.recordedSpeedMps
    if (
      recordedSpeed != null &&
      Number.isFinite(recordedSpeed) &&
      recordedSpeed >= 0
    ) {
      recordedSpeeds.push(recordedSpeed)
    }
  }
  const count = endIndex - startIndex + 1
  const meanLng = sumLng / count
  const meanLat = sumLat / count
  for (let index = startIndex; index <= endIndex; index += 1) {
    const point = path[index]!
    const pointLng = unwrapLongitude(meanLng, point.lng)
    context.work.pauseWindowPointsVisited += 1
    if (
      haversineMeters([meanLng, meanLat], [pointLng, point.lat]) >
      PAUSE_DRIFT_MAX_RADIUS_M
    ) {
      return false
    }
  }
  const netDistanceM = haversineMeters(
    [first.lng, first.lat],
    [last.lng, last.lat]
  )
  const medianSpeed = median(speeds)
  if (
    pathDistanceM < PAUSE_DRIFT_MIN_PATH_DISTANCE_M ||
    pathDistanceM <
      PAUSE_DRIFT_PATH_TO_NET_RATIO *
        Math.max(netDistanceM, PAUSE_DRIFT_MAX_NET_DISTANCE_M - 5) ||
    netDistanceM > PAUSE_DRIFT_MAX_NET_DISTANCE_M ||
    medianSpeed == null ||
    medianSpeed > PAUSE_DRIFT_MAX_MEDIAN_SPEED_MPS
  ) {
    return false
  }
  if (recordedSpeeds.length >= Math.ceil(count / 2)) {
    const slowCount = recordedSpeeds.filter((speed) => speed < 1).length
    if (slowCount / recordedSpeeds.length < 0.8) return false
  }
  return true
}

function findPauseRanges(
  path: readonly AnomalyPoint[],
  context: AnalysisContext
): PauseRange[] {
  const ranges: PauseRange[] = []
  let window: PauseWindowPoint[] = []
  let windowStart = 0
  let sumLng = 0
  let sumLat = 0
  let sumPathDistanceM = 0
  let previousUnwrappedLng: number | null = null
  let activeCandidate: PauseRange | null = null
  let minLng: NumericDequeEntry[] = []
  let maxLng: NumericDequeEntry[] = []
  let minLat: NumericDequeEntry[] = []
  let maxLat: NumericDequeEntry[] = []

  const reset = () => {
    window = []
    windowStart = 0
    sumLng = 0
    sumLat = 0
    sumPathDistanceM = 0
    previousUnwrappedLng = null
    minLng = []
    maxLng = []
    minLat = []
    maxLat = []
  }

  const finishCandidate = () => {
    if (activeCandidate) {
      if (
        pauseRangeQualifies(
          path,
          activeCandidate.startIndex,
          activeCandidate.endIndex,
          context
        )
      ) {
        ranges.push(activeCandidate)
      }
      activeCandidate = null
    }
  }

  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!
    const timestamp = finiteTimestamp(point)
    if (timestamp == null) {
      finishCandidate()
      reset()
      continue
    }

    const previous = index > 0 ? path[index - 1] : undefined
    const previousTimestamp = previous ? finiteTimestamp(previous) : null
    if (previousTimestamp == null || previousUnwrappedLng == null) {
      finishCandidate()
      reset()
    }

    const unwrappedLng: number =
      previousUnwrappedLng == null
        ? point.lng
        : unwrapLongitude(previousUnwrappedLng, point.lng)
    const measured =
      previous && previousTimestamp != null
        ? edgeDistance(previous, point, context.work)
        : { distanceM: 0, rawDeltaMs: null }
    const speedMps =
      measured.rawDeltaMs != null && measured.rawDeltaMs > 0
        ? measured.distanceM / (measured.rawDeltaMs / 1_000)
        : null
    const item: PauseWindowPoint = {
      pointIndex: index,
      point,
      unwrappedLng,
      distanceM: measured.distanceM,
      speedMps,
    }
    window.push(item)
    sumLng += unwrappedLng
    sumLat += point.lat
    sumPathDistanceM += measured.distanceM
    addMonotonicEntry(minLng, { pointIndex: index, value: unwrappedLng }, true)
    addMonotonicEntry(maxLng, { pointIndex: index, value: unwrappedLng }, false)
    addMonotonicEntry(minLat, { pointIndex: index, value: point.lat }, true)
    addMonotonicEntry(maxLat, { pointIndex: index, value: point.lat }, false)
    previousUnwrappedLng = unwrappedLng

    const removeFirst = () => {
      const first = window[windowStart]!
      windowStart += 1
      sumLng -= first.unwrappedLng
      sumLat -= first.point.lat
      sumPathDistanceM -= first.distanceM
      dropOldMonotonicEntries(minLng, first.pointIndex + 1)
      dropOldMonotonicEntries(maxLng, first.pointIndex + 1)
      dropOldMonotonicEntries(minLat, first.pointIndex + 1)
      dropOldMonotonicEntries(maxLat, first.pointIndex + 1)
      if (windowStart > 1_024) {
        window = window.slice(windowStart)
        windowStart = 0
      }
    }

    while (window.length - windowStart > PAUSE_DRIFT_MAX_WINDOW_POINTS) {
      removeFirst()
    }

    const hasSpatialBreak = () =>
      !pauseWindowIsSpatiallySmall(
        window,
        windowStart,
        sumLng,
        sumLat,
        minLng[0]!,
        maxLng[0]!,
        minLat[0]!,
        maxLat[0]!
      )
    if (window.length - windowStart > 1 && hasSpatialBreak()) {
      finishCandidate()
      while (window.length - windowStart > 1 && hasSpatialBreak()) {
        removeFirst()
      }
    }

    const first = window[windowStart]
    const last = window[window.length - 1]
    const windowLength = window.length - windowStart
    const durationMs =
      first && last
        ? (finiteTimestamp(last.point) ?? 0) -
          (finiteTimestamp(first.point) ?? 0)
        : 0
    const windowPathDistanceM = sumPathDistanceM
    const netDistanceM =
      first && last
        ? haversineMeters(
            [first.point.lng, first.point.lat],
            [last.point.lng, last.point.lat]
          )
        : Infinity
    const cheapCandidate =
      windowLength >= 3 &&
      durationMs >= PAUSE_DRIFT_MIN_DURATION_MS &&
      windowPathDistanceM >= PAUSE_DRIFT_MIN_PATH_DISTANCE_M &&
      netDistanceM <= PAUSE_DRIFT_MAX_NET_DISTANCE_M &&
      windowPathDistanceM >=
        PAUSE_DRIFT_PATH_TO_NET_RATIO *
          Math.max(netDistanceM, PAUSE_DRIFT_MAX_NET_DISTANCE_M - 5)

    if (cheapCandidate) {
      if (!activeCandidate) {
        activeCandidate = {
          startIndex: first!.pointIndex,
          endIndex: last!.pointIndex,
        }
      } else {
        activeCandidate.endIndex = last!.pointIndex
      }
    } else if (activeCandidate) {
      finishCandidate()
    }
  }
  finishCandidate()

  if (ranges.length < 2) return ranges
  const merged: PauseRange[] = [ranges[0]!]
  for (const range of ranges.slice(1)) {
    const previous = merged[merged.length - 1]!
    if (range.startIndex <= previous.endIndex + 1) {
      previous.endIndex = Math.max(previous.endIndex, range.endIndex)
    } else {
      merged.push(range)
    }
  }
  return merged
}

function addPauseRemoval(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  path: EmittedPath,
  range: PauseRange,
  context: AnalysisContext
): void {
  const interiorStart = range.startIndex + 1
  const interiorEnd = range.endIndex - 1
  const entry =
    interiorStart <= interiorEnd
      ? classifyEdge(
          path.points[range.startIndex]!,
          path.points[interiorStart]!,
          { distances: [], deltas: [] },
          context
        )
      : evidenceForPoint({ distances: [], deltas: [] }, context)
  addReason(counts, "pause_drift")
  counts.splitCount += 1
  counts.removalSplitCount += 1
  collectExample(
    examples,
    makeExample(
      "pause_drift",
      "remove",
      path.sourcePathIndex,
      path.points,
      interiorStart,
      Math.max(interiorStart, interiorEnd),
      entry,
      context,
      {
        triggerCode: "pause_drift",
        removedPointCount: Math.max(0, interiorEnd - interiorStart + 1),
        rejoinPointIndex: range.endIndex,
        rejoin: {
          distanceM: haversineMeters(
            [
              path.points[range.startIndex]!.lng,
              path.points[range.startIndex]!.lat,
            ],
            [path.points[range.endIndex]!.lng, path.points[range.endIndex]!.lat]
          ),
          elapsedMs:
            finiteTimestamp(path.points[range.endIndex]!) != null &&
            finiteTimestamp(path.points[range.startIndex]!) != null
              ? finiteTimestamp(path.points[range.endIndex]!)! -
                finiteTimestamp(path.points[range.startIndex]!)!
              : null,
          rejoinLimitM: REJOIN_POSITION_CEILING_M,
          reachable: true,
        },
      }
    )
  )
}

function applyPauseDriftCleanup(
  paths: EmittedPath[],
  context: AnalysisContext,
  counts: MutableCounts,
  examples: GpsAnomalyExample[]
): EmittedPath[] {
  const cleaned: EmittedPath[] = []
  for (const path of paths) {
    const ranges = findPauseRanges(path.points, context)
    if (ranges.length === 0) {
      cleaned.push(path)
      continue
    }
    let cursor = 0
    for (const range of ranges) {
      addPauseRemoval(counts, examples, path, range, context)
      const before = path.points.slice(cursor, range.startIndex + 1)
      if (before.length >= MIN_RETAINED_PATH_POINTS) {
        cleaned.push({ sourcePathIndex: path.sourcePathIndex, points: before })
      } else if (before.length > 0) {
        addReason(counts, "dropped_short_path")
      }
      cursor = range.endIndex
    }
    const after = path.points.slice(cursor)
    if (after.length >= MIN_RETAINED_PATH_POINTS) {
      cleaned.push({ sourcePathIndex: path.sourcePathIndex, points: after })
    } else if (after.length > 0) {
      addReason(counts, "dropped_short_path")
    }
  }
  return cleaned
}

/**
 * Clean each original source path independently. The result only contains raw
 * points; parsers remain responsible for canonical geometry and timestamps.
 */
export function detectGpsAnomalies(
  sourcePaths: readonly AnomalySourcePath[],
  options: GpsAnomalyOptions = {}
): GpsAnomalyResult {
  const context: AnalysisContext = {
    maxSpeedMps: maxPlausibleSpeed(options.activityType),
    work: {
      distanceCalculations: 0,
      pointsVisited: 0,
      boundedLookaheadCount: 0,
      maxDistanceWindowSize: 0,
      maxTimeWindowSize: 0,
      pauseWindowPointsVisited: 0,
    },
  }
  const counts: MutableCounts = {
    inputPoints: sourcePaths.reduce(
      (total, source) => total + source.points.length,
      0
    ),
    splitCount: 0,
    gapSplitCount: 0,
    removalSplitCount: 0,
    trimmedPrefixPoints: 0,
    trimmedSuffixPoints: 0,
    reasons: {},
  }
  const examples: GpsAnomalyExample[] = []
  const analyzedPaths: EmittedPath[] = []

  for (const source of sourcePaths) {
    context.work.pointsVisited += source.points.length
    const baseline: RollingBaseline = { distances: [], deltas: [] }
    let validPoints: AnomalyPoint[] = []
    let invalidPoints: AnomalyPoint[] = []
    const flushValid = () => {
      if (validPoints.length > 0) {
        analyzedPaths.push(
          ...analyzeValidSegment(
            source.sourcePathIndex,
            validPoints,
            context,
            counts,
            examples
          )
        )
      }
      validPoints = []
    }
    const flushInvalid = () => {
      if (invalidPoints.length > 0) {
        addInvalidCoordinateRemoval(
          counts,
          examples,
          source.sourcePathIndex,
          invalidPoints,
          baseline,
          context
        )
      }
      invalidPoints = []
    }

    for (const point of source.points) {
      if (!isUsablePoint(point)) {
        flushValid()
        invalidPoints.push(point)
      } else {
        flushInvalid()
        validPoints.push(point)
      }
    }
    flushValid()
    flushInvalid()
  }

  const cleanedPaths = applyPauseDriftCleanup(
    analyzedPaths,
    context,
    counts,
    examples
  )
  const paths = cleanedPaths.map(({ points }) => points)
  const retainedPoints = paths.reduce((total, path) => total + path.length, 0)
  const removedPoints = Math.max(0, counts.inputPoints - retainedPoints)
  counts.reasons = Object.fromEntries(
    Object.entries(counts.reasons).filter(([, count]) => (count ?? 0) > 0)
  ) as Partial<Record<GpsAnomalyCode, number>>
  const hasDecision = Object.keys(counts.reasons).length > 0
  const status: GpsAnomalyResult["status"] =
    paths.length === 0
      ? "rejected"
      : hasDecision || removedPoints > 0
        ? "cleaned"
        : "clean"

  return {
    status,
    paths,
    counts: {
      inputPoints: counts.inputPoints,
      retainedPoints,
      removedPoints,
      emittedPathCount: paths.length,
      splitCount: counts.splitCount,
      gapSplitCount: counts.gapSplitCount,
      removalSplitCount: counts.removalSplitCount,
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
