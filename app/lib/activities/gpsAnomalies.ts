import type { ActivityType, RawPoint } from "~shared/activities"
import {
  ANOMALY_ALGORITHM_VERSION,
  GPS_ACCURACY_MULTIPLIER,
  HARD_TELEPORT_DISTANCE_M,
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
  RELATIVE_ACCURACY_FLOOR_M,
  RELATIVE_ACCURACY_MIN_SAMPLES,
  RELATIVE_ACCURACY_MULTIPLIER,
  RELIABILITY_MIN_BASELINE_EDGES,
  RELIABILITY_WINDOW_EDGES,
  SPEED_MISMATCH_COORDINATE_FLOOR_MPS,
  SPEED_MISMATCH_DIFFERENCE_MPS,
  SPEED_MISMATCH_RATIO,
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

export type GpsEdgeEvidenceCode =
  | "non_positive_time"
  | "recording_gap"
  | "impossible_speed"
  | "local_distance_jump"
  | "hard_teleport"
  | "recorded_speed_mismatch"

export type GpsPointEvidenceCode =
  | "invalid_coordinate"
  | "untrusted_accuracy"
  | "relative_accuracy_outlier"

export type GpsCleaningDecisionCode =
  | "recording_gap"
  | "non_positive_time"
  | "local_spike"
  | "local_excursion"
  | "pause_drift"
  | "untrusted_prefix"
  | "untrusted_suffix"
  | "isolated_fix"
  | "untrusted_island"
  | "recovered_fragment"
  | "dropped_short_path"

export type GpsAnomalyCode =
  | GpsEdgeEvidenceCode
  | GpsPointEvidenceCode
  | GpsCleaningDecisionCode

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
    candidatePointsVisited: number
    fragmentPromotions: number
    mergedRemovalRangeCount: number
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
  codes: GpsEdgeEvidenceCode[]
  primaryCode: GpsEdgeEvidenceCode | null
  /** Kept during the staged migration; output logic uses `codes`. */
  reason: GpsAnomalyCode | null
}

interface RollingBaseline {
  distances: number[]
  deltas: number[]
  accuracies: number[]
}

interface MutableWork {
  distanceCalculations: number
  pointsVisited: number
  boundedLookaheadCount: number
  candidatePointsVisited: number
  fragmentPromotions: number
  mergedRemovalRangeCount: number
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
  removalRecords: RemovalRecord[]
  splitRecords: SplitRecord[]
  nextDecisionOrder: number
}

interface RemovalRecord {
  sourcePathIndex: number
  points: readonly AnomalyPoint[]
  startIndex: number
  endIndex: number
  code: GpsAnomalyCode
  entry: EdgeEvidence
  triggerCode?: GpsAnomalyCode
  rejoinPointIndex?: number | null
  rejoin?: RejoinEvidence | null
  isPrefix?: boolean
  isSuffix?: boolean
  order: number
}

interface SplitRecord {
  code: "recording_gap" | "non_positive_time" | "recovered_fragment"
  sourcePathIndex: number
  points: readonly AnomalyPoint[]
  startIndex: number
  endIndex: number
  entry: EdgeEvidence
  triggerCode?: GpsAnomalyCode
  order: number
}

interface EmittedPath {
  sourcePathIndex: number
  points: AnomalyPoint[]
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

function finiteRecordedSpeed(point: AnomalyPoint): number | null {
  return point.recordedSpeedMps != null &&
    Number.isFinite(point.recordedSpeedMps) &&
    point.recordedSpeedMps >= 0
    ? point.recordedSpeedMps
    : null
}

export function isRelativeAccuracyOutlier(
  accuracyM: number,
  trustedAccuracies: readonly number[]
): boolean {
  if (
    !Number.isFinite(accuracyM) ||
    accuracyM < 0 ||
    trustedAccuracies.length < RELATIVE_ACCURACY_MIN_SAMPLES
  ) {
    return false
  }
  const trustedMedian = median(trustedAccuracies)
  return (
    trustedMedian != null &&
    accuracyM >
      Math.max(
        RELATIVE_ACCURACY_FLOOR_M,
        trustedMedian * RELATIVE_ACCURACY_MULTIPLIER
      )
  )
}

export function isRecordedSpeedMismatch(
  coordinateSpeedMps: number | null,
  recordedSpeedMps: number | null
): boolean {
  if (
    coordinateSpeedMps == null ||
    recordedSpeedMps == null ||
    !Number.isFinite(coordinateSpeedMps) ||
    !Number.isFinite(recordedSpeedMps) ||
    coordinateSpeedMps < SPEED_MISMATCH_COORDINATE_FLOOR_MPS
  ) {
    return false
  }
  return (
    Math.abs(coordinateSpeedMps - recordedSpeedMps) >
      SPEED_MISMATCH_DIFFERENCE_MPS &&
    (recordedSpeedMps === 0 ||
      Math.max(coordinateSpeedMps, recordedSpeedMps) /
        Math.min(coordinateSpeedMps, recordedSpeedMps) >=
        SPEED_MISMATCH_RATIO)
  )
}

function isUntrustedAccuracy(point: AnomalyPoint): boolean {
  const accuracy = finiteAccuracy(point)
  return accuracy != null && accuracy > MAX_TRUSTED_GPS_ACCURACY_M
}

function pointEvidence(
  point: AnomalyPoint,
  baseline: RollingBaseline
): GpsPointEvidenceCode[] {
  const codes: GpsPointEvidenceCode[] = []
  if (!isUsablePoint(point)) codes.push("invalid_coordinate")
  const accuracy = finiteAccuracy(point)
  if (accuracy != null && accuracy > MAX_TRUSTED_GPS_ACCURACY_M) {
    codes.push("untrusted_accuracy")
  } else if (
    accuracy != null &&
    isRelativeAccuracyOutlier(accuracy, baseline.accuracies)
  ) {
    codes.push("relative_accuracy_outlier")
  }
  return codes
}

function isUnsafePointEvidence(codes: readonly GpsPointEvidenceCode[]) {
  return (
    codes.includes("invalid_coordinate") ||
    codes.includes("untrusted_accuracy") ||
    codes.includes("relative_accuracy_outlier")
  )
}

function recordRemoval(
  counts: MutableCounts,
  record: Omit<RemovalRecord, "order">
): void {
  counts.removalRecords.push({
    ...record,
    order: counts.nextDecisionOrder++,
  })
}

function recordSplit(
  counts: MutableCounts,
  record: Omit<SplitRecord, "order">
): void {
  counts.splitRecords.push({
    ...record,
    order: counts.nextDecisionOrder++,
  })
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
        ? TIME_GAP_FLOOR_MS
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

  const codes: GpsEdgeEvidenceCode[] = []
  if (
    (firstAccuracyM != null && firstAccuracyM > MAX_TRUSTED_GPS_ACCURACY_M) ||
    (secondAccuracyM != null && secondAccuracyM > MAX_TRUSTED_GPS_ACCURACY_M)
  ) {
    // Accuracy is point evidence. The edge remains classifiable on its own so
    // a gap can retain both endpoints while an outlier island is resolved
    // later with both incident edges available.
  }
  if (rawDeltaMs != null && rawDeltaMs <= 0) {
    codes.push("non_positive_time")
  }
  if (deltaMs != null && deltaMs > timeGapLimitMs) {
    codes.push("recording_gap")
  }
  if (distanceM >= HARD_TELEPORT_DISTANCE_M) {
    codes.push("hard_teleport")
  }
  if (
    deltaMs != null &&
    distanceM >= SPEED_TEST_DISTANCE_FLOOR_M &&
    speedMps != null &&
    speedMps > context.maxSpeedMps
  ) {
    codes.push("impossible_speed")
  }
  if (distanceM > effectiveDistanceLimitM) {
    codes.push("local_distance_jump")
  }
  const recordedSpeed = finiteRecordedSpeed(second)
  if (isRecordedSpeedMismatch(speedMps, recordedSpeed)) {
    codes.push("recorded_speed_mismatch")
  }

  const primaryOrder: GpsEdgeEvidenceCode[] = [
    "non_positive_time",
    "recording_gap",
    "hard_teleport",
    "impossible_speed",
    "local_distance_jump",
    "recorded_speed_mismatch",
  ]
  const primaryCode = primaryOrder.find((code) => codes.includes(code)) ?? null
  const pointCodes = [
    ...pointEvidence(first, baseline),
    ...pointEvidence(second, baseline),
  ]

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
    codes,
    primaryCode,
    reason: primaryCode ?? pointCodes[0] ?? null,
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
  destination: AnomalyPoint,
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
  const accuracy = finiteAccuracy(destination)
  if (accuracy != null && accuracy <= MAX_TRUSTED_GPS_ACCURACY_M) {
    baseline.accuracies.push(accuracy)
    if (baseline.accuracies.length > RELIABILITY_WINDOW_EDGES) {
      baseline.accuracies.shift()
    }
  }
  updateWindowWork(baseline, work)
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
    codes: [],
    primaryCode: null,
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
    startPointIndex?: number
    endPointIndex?: number
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
      options.startPointIndex ??
      points[Math.max(0, startIndex)]?.sourcePointIndex ??
      startIndex,
    endPointIndex:
      options.endPointIndex ??
      points[Math.max(0, endIndex)]?.sourcePointIndex ??
      endIndex,
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
  recordRemoval(counts, {
    sourcePathIndex,
    points,
    startIndex,
    endIndex,
    code: "untrusted_prefix",
    entry,
    ...(triggerCode ? { triggerCode } : {}),
    isPrefix: true,
  })
  void examples
  void context
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
  recordSplit(counts, {
    code,
    sourcePathIndex,
    points,
    startIndex: edgeIndex,
    endIndex: edgeIndex + 1,
    entry,
  })
  void examples
  void context
}

function addRecoverySplit(
  counts: MutableCounts,
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  entryIndex: number,
  promotedEndIndex: number,
  entry: EdgeEvidence
): void {
  recordSplit(counts, {
    code: "recovered_fragment",
    sourcePathIndex,
    points,
    startIndex: Math.max(0, entryIndex - 1),
    endIndex: promotedEndIndex,
    entry,
    triggerCode: entry.primaryCode ?? entry.reason ?? undefined,
  })
}

function addRemovalSplit(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  code: GpsAnomalyCode,
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
  if (endIndex < startIndex) return
  recordRemoval(counts, {
    sourcePathIndex,
    points,
    startIndex,
    endIndex,
    code,
    entry,
    ...options,
    ...(code === "untrusted_prefix" ? { isPrefix: true } : {}),
    ...(code === "untrusted_suffix" ? { isSuffix: true } : {}),
  })
  void examples
  void context
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
    if (
      !isReliableEdge(
        points[index + offset]!,
        points[index + offset + 1]!,
        edge,
        baseline
      )
    ) {
      return false
    }
  }
  return true
}

function isReliableEdge(
  first: AnomalyPoint,
  second: AnomalyPoint,
  edge: EdgeEvidence,
  baseline: RollingBaseline
): boolean {
  return (
    edge.codes.every((code) => code === "recorded_speed_mismatch") &&
    !isUnsafePointEvidence(pointEvidence(first, baseline)) &&
    !isUnsafePointEvidence(pointEvidence(second, baseline))
  )
}

function hasTemporalBoundary(edge: EdgeEvidence): boolean {
  return (
    edge.codes.includes("recording_gap") ||
    edge.codes.includes("non_positive_time")
  )
}

function hasSpatialEvidence(edge: EdgeEvidence): boolean {
  return edge.codes.some(
    (code) =>
      code === "impossible_speed" ||
      code === "local_distance_jump" ||
      code === "hard_teleport"
  )
}

function boundaryCode(
  edge: EdgeEvidence
): "recording_gap" | "non_positive_time" {
  return edge.codes.includes("recording_gap")
    ? "recording_gap"
    : "non_positive_time"
}

function removalCodeForIsland(
  points: readonly AnomalyPoint[],
  startIndex: number,
  endIndex: number,
  isSuffix = false
): "isolated_fix" | "untrusted_island" | "untrusted_suffix" {
  if (isSuffix) return "untrusted_suffix"
  const length = endIndex - startIndex + 1
  return length === 1 ? "isolated_fix" : "untrusted_island"
}

function addRecoveredFragmentSplit(
  counts: MutableCounts,
  examples: GpsAnomalyExample[],
  sourcePathIndex: number,
  points: readonly AnomalyPoint[],
  entryIndex: number,
  promotedEndIndex: number,
  entry: EdgeEvidence,
  context: AnalysisContext
): void {
  addRecoverySplit(
    counts,
    sourcePathIndex,
    points,
    entryIndex,
    promotedEndIndex,
    entry
  )
  void examples
  void context
}

interface CandidateBuffer {
  points: AnomalyPoint[]
  startIndex: number
  reliableEdges: EdgeEvidence[]
  requiresRecovery: boolean
  allowShortPath: boolean
  boundaryEntry: EdgeEvidence | null
}

/**
 * Version-3 forward scanner. Candidate buffers are deliberately separate from
 * emitted paths: a boundary is not enough to trust the points on either side,
 * and a later coherent fragment must remain reachable after an excursion.
 */
function analyzeValidSegmentV3(
  sourcePathIndex: number,
  points: AnomalyPoint[],
  context: AnalysisContext,
  counts: MutableCounts,
  examples: GpsAnomalyExample[]
): EmittedPath[] {
  if (points.length === 0) return []

  const baseline: RollingBaseline = {
    distances: [],
    deltas: [],
    accuracies: [],
  }
  const output: EmittedPath[] = []
  let candidate: CandidateBuffer | null = null
  let trustedPath: EmittedPath | null = null
  let excursion: {
    points: AnomalyPoint[]
    startIndex: number
    lastTrustedIndex: number
    entry: EdgeEvidence
    reliableEdges: EdgeEvidence[]
  } | null = null

  const resetBaseline = () => {
    baseline.distances.length = 0
    baseline.deltas.length = 0
    baseline.accuracies.length = 0
  }

  const startCandidate = (
    index: number,
    requiresRecovery: boolean,
    allowShortPath: boolean,
    boundaryEntry: EdgeEvidence | null = null
  ) => {
    resetBaseline()
    candidate = {
      points: [points[index]!],
      startIndex: index,
      reliableEdges: [],
      requiresRecovery,
      allowShortPath,
      boundaryEntry,
    }
    context.work.candidatePointsVisited += 1
    trustedPath = null
    excursion = null
  }

  const addRemoval = (
    code:
      | "isolated_fix"
      | "untrusted_island"
      | "untrusted_suffix"
      | "untrusted_prefix"
      | "local_spike"
      | "local_excursion"
      | "untrusted_accuracy",
    startIndex: number,
    endIndex: number,
    entry: EdgeEvidence,
    triggerCode?: GpsAnomalyCode,
    rejoinPointIndex?: number,
    rejoin?: RejoinEvidence | null
  ) => {
    if (endIndex < startIndex) return
    if (code === "untrusted_prefix") {
      addPrefixRemoval(
        counts,
        examples,
        sourcePathIndex,
        points,
        startIndex,
        endIndex,
        entry,
        context,
        triggerCode
      )
      return
    }
    addRemovalSplit(
      counts,
      examples,
      code,
      sourcePathIndex,
      points,
      startIndex,
      endIndex,
      entry,
      context,
      {
        triggerCode,
        rejoinPointIndex,
        rejoin,
      }
    )
  }

  const emitCandidate = (atEnd = false) => {
    if (!candidate) return
    const candidateEnd = candidate.startIndex + candidate.points.length - 1
    const ordinaryConfidence = candidate.reliableEdges.length >= 2
    const recoveryConfidence =
      candidate.reliableEdges.length >= 4 && candidate.points.length >= 5
    const confident = candidate.requiresRecovery
      ? recoveryConfidence
      : ordinaryConfidence
    const canKeep =
      candidate.points.length >= MIN_RETAINED_PATH_POINTS &&
      (confident || candidate.allowShortPath)

    if (canKeep) {
      output.push({ sourcePathIndex, points: candidate.points })
    } else if (candidate.points.length > 0) {
      const code = candidate.requiresRecovery
        ? removalCodeForIsland(
            points,
            candidate.startIndex,
            candidateEnd,
            atEnd
          )
        : candidate.startIndex === 0
          ? "untrusted_prefix"
          : removalCodeForIsland(points, candidate.startIndex, candidateEnd)
      addRemoval(
        code,
        candidate.startIndex,
        candidateEnd,
        candidate.boundaryEntry ?? evidenceForPoint(baseline, context),
        candidate.boundaryEntry?.reason ?? undefined
      )
    }
    candidate = null
  }

  const promoteCandidate = () => {
    if (!candidate) return
    const newPath: EmittedPath = { sourcePathIndex, points: candidate.points }
    output.push(newPath)
    trustedPath = newPath
    resetBaseline()
    for (
      let edgeIndex = 0;
      edgeIndex < candidate.reliableEdges.length;
      edgeIndex += 1
    ) {
      appendBaseline(
        baseline,
        candidate.reliableEdges[edgeIndex]!,
        candidate.points[edgeIndex + 1]!,
        context.work
      )
    }
    if (candidate.requiresRecovery) {
      addRecoveredFragmentSplit(
        counts,
        examples,
        sourcePathIndex,
        points,
        candidate.startIndex,
        candidate.startIndex + candidate.points.length - 1,
        candidate.boundaryEntry ?? evidenceForPoint(baseline, context),
        context
      )
      context.work.fragmentPromotions += 1
    }
    candidate = null
  }

  const finishExcursion = (isSuffix: boolean) => {
    if (!excursion) return
    const endIndex = excursion.startIndex + excursion.points.length - 1
    const code = removalCodeForIsland(
      points,
      excursion.startIndex,
      endIndex,
      isSuffix
    )
    addRemoval(
      code,
      excursion.startIndex,
      endIndex,
      excursion.entry,
      excursion.entry.reason ?? undefined
    )
    excursion = null
    trustedPath = null
  }

  startCandidate(0, false, false)
  let index = 1
  while (index < points.length) {
    const first = points[index - 1]!
    const second = points[index]!

    if (candidate) {
      const edge = classifyEdge(first, second, baseline, context)
      const reliable = isReliableEdge(first, second, edge, baseline)
      if (reliable) {
        candidate.points.push(second)
        candidate.reliableEdges.push(edge)
        context.work.candidatePointsVisited += 1
        appendBaseline(baseline, edge, second, context.work)
        const ordinaryConfidence = candidate.reliableEdges.length >= 2
        const recoveryConfidence =
          candidate.reliableEdges.length >= 4 && candidate.points.length >= 5
        if (
          (candidate.requiresRecovery && recoveryConfidence) ||
          (!candidate.requiresRecovery && ordinaryConfidence)
        ) {
          promoteCandidate()
        }
        index += 1
        continue
      }

      if (hasTemporalBoundary(edge)) {
        if (!hasSpatialEvidence(edge)) candidate.allowShortPath = true
        emitCandidate()
        addBoundarySplit(
          counts,
          examples,
          boundaryCode(edge),
          sourcePathIndex,
          points,
          index - 1,
          edge,
          context
        )
        startCandidate(index, false, true, edge)
        index += 1
        continue
      }

      const hadTrustedOutput = output.length > 0
      emitCandidate()
      startCandidate(index, hadTrustedOutput, false, edge)
      index += 1
      continue
    }

    const activeTrustedPath = trustedPath as EmittedPath | null
    if (activeTrustedPath) {
      const edge = classifyEdge(first, second, baseline, context)
      const reliable = isReliableEdge(first, second, edge, baseline)
      if (reliable) {
        activeTrustedPath.points.push(second)
        appendBaseline(baseline, edge, second, context.work)
        index += 1
        continue
      }
      if (hasTemporalBoundary(edge)) {
        addBoundarySplit(
          counts,
          examples,
          boundaryCode(edge),
          sourcePathIndex,
          points,
          index - 1,
          edge,
          context
        )
        startCandidate(index, false, true, edge)
        index += 1
        continue
      }
      excursion = {
        points: [second],
        startIndex: index,
        lastTrustedIndex: index - 1,
        entry: edge,
        reliableEdges: [],
      }
      trustedPath = null
      index += 1
      continue
    }

    if (excursion) {
      const edge = classifyEdge(first, second, baseline, context)
      const rejoin = rejoinFromTrusted(
        points[excursion.lastTrustedIndex]!,
        second,
        excursion.points.length,
        baseline,
        context
      )
      if (rejoin.reachable && confirmRejoin(points, index, baseline, context)) {
        const removedEnd = index - 1
        const code =
          excursion.entry.reason === "untrusted_accuracy" ||
          excursion.entry.reason === "relative_accuracy_outlier"
            ? "untrusted_accuracy"
            : excursion.points.length === 1
              ? "local_spike"
              : "local_excursion"
        addRemoval(
          code,
          excursion.startIndex,
          removedEnd,
          excursion.entry,
          excursion.entry.reason ?? undefined,
          index,
          rejoin
        )
        startCandidate(index, false, false)
        index += 1
        continue
      }

      if (hasTemporalBoundary(edge)) {
        finishExcursion(false)
        addBoundarySplit(
          counts,
          examples,
          boundaryCode(edge),
          sourcePathIndex,
          points,
          index - 1,
          edge,
          context
        )
        startCandidate(index, true, false, edge)
        index += 1
        continue
      }

      if (isReliableEdge(first, second, edge, baseline)) {
        excursion.points.push(second)
        excursion.reliableEdges.push(edge)
        context.work.candidatePointsVisited += 1
        if (
          excursion.reliableEdges.length >= 4 &&
          excursion.points.length >= 5
        ) {
          const promoted: CandidateBuffer = {
            points: excursion.points,
            startIndex: excursion.startIndex,
            reliableEdges: excursion.reliableEdges,
            requiresRecovery: true,
            allowShortPath: false,
            boundaryEntry: excursion.entry,
          }
          excursion = null
          candidate = promoted
          promoteCandidate()
        }
        index += 1
        continue
      }

      finishExcursion(false)
      startCandidate(index, true, false, edge)
      index += 1
      continue
    }

    startCandidate(index, false, false)
    index += 1
  }

  if (candidate) {
    if (!candidate.requiresRecovery) candidate.allowShortPath = true
    emitCandidate(true)
  }
  if (excursion) finishExcursion(true)

  return output.filter((path) => path.points.length >= MIN_RETAINED_PATH_POINTS)
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
  const entry = evidenceForPoint(baseline, context)
  recordRemoval(counts, {
    sourcePathIndex,
    points: invalidPoints,
    startIndex: 0,
    endIndex: invalidPoints.length - 1,
    code: "invalid_coordinate",
    entry,
  })
  void examples
}

function unwrapLongitude(previous: number, current: number): number {
  let result = current
  while (result - previous > 180) result -= 360
  while (result - previous < -180) result += 360
  return result
}

interface PauseRange {
  startIndex: number
  endIndex: number
}

interface StationarySummary {
  startIndex: number
  endIndex: number
  pointCount: number
  centerLng: number
  centerLat: number
  radiusM: number
  netDistanceM: number
  pathDistanceM: number
  durationMs: number
  medianSpeedMps: number
  recordedCount: number
  slowRecordedCount: number
}

interface StationaryAccumulator {
  startIndex: number
  endIndex: number
  pointCount: number
  firstPoint: AnomalyPoint
  lastPoint: AnomalyPoint
  previousUnwrappedLng: number
  sumLng: number
  sumLat: number
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  pathDistanceM: number
  speeds: number[]
  recordedCount: number
  slowRecordedCount: number
}

function stationaryRadiusM(
  centerLng: number,
  centerLat: number,
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number
): number {
  const longitudeMeters =
    111_195 * Math.max(0.01, Math.cos((centerLat * Math.PI) / 180))
  return Math.max(
    Math.abs(maxLng - centerLng) * longitudeMeters,
    Math.abs(minLng - centerLng) * longitudeMeters,
    Math.abs(maxLat - centerLat) * 111_195,
    Math.abs(minLat - centerLat) * 111_195
  )
}

function newStationaryAccumulator(
  point: AnomalyPoint,
  index: number
): StationaryAccumulator {
  return {
    startIndex: index,
    endIndex: index,
    pointCount: 1,
    firstPoint: point,
    lastPoint: point,
    previousUnwrappedLng: point.lng,
    sumLng: point.lng,
    sumLat: point.lat,
    minLng: point.lng,
    maxLng: point.lng,
    minLat: point.lat,
    maxLat: point.lat,
    pathDistanceM: 0,
    speeds: [],
    recordedCount: 0,
    slowRecordedCount: 0,
  }
}

function addStationaryPoint(
  accumulator: StationaryAccumulator,
  point: AnomalyPoint,
  index: number,
  previous: AnomalyPoint,
  context: AnalysisContext
): boolean {
  const previousTimestamp = finiteTimestamp(previous)
  const timestamp = finiteTimestamp(point)
  if (
    previousTimestamp == null ||
    timestamp == null ||
    timestamp - previousTimestamp <= 0 ||
    timestamp - previousTimestamp > TIME_GAP_CEILING_MS
  ) {
    return false
  }
  const unwrappedLng = unwrapLongitude(
    accumulator.previousUnwrappedLng,
    point.lng
  )
  const measured = edgeDistance(previous, point, context.work)
  const speedMps =
    measured.distanceM / ((timestamp - previousTimestamp) / 1_000)
  accumulator.endIndex = index
  accumulator.pointCount += 1
  accumulator.lastPoint = point
  accumulator.previousUnwrappedLng = unwrappedLng
  accumulator.sumLng += unwrappedLng
  accumulator.sumLat += point.lat
  accumulator.minLng = Math.min(accumulator.minLng, unwrappedLng)
  accumulator.maxLng = Math.max(accumulator.maxLng, unwrappedLng)
  accumulator.minLat = Math.min(accumulator.minLat, point.lat)
  accumulator.maxLat = Math.max(accumulator.maxLat, point.lat)
  accumulator.pathDistanceM += measured.distanceM
  accumulator.speeds.push(speedMps)
  const recordedSpeed = finiteRecordedSpeed(point)
  if (recordedSpeed != null) {
    accumulator.recordedCount += 1
    if (recordedSpeed < 1) accumulator.slowRecordedCount += 1
  }
  context.work.pauseWindowPointsVisited += 1
  return true
}

function summarizeStationaryAccumulator(
  accumulator: StationaryAccumulator
): StationarySummary {
  const centerLng = accumulator.sumLng / accumulator.pointCount
  const centerLat = accumulator.sumLat / accumulator.pointCount
  const firstTimestamp = finiteTimestamp(accumulator.firstPoint)
  const lastTimestamp = finiteTimestamp(accumulator.lastPoint)
  return {
    startIndex: accumulator.startIndex,
    endIndex: accumulator.endIndex,
    pointCount: accumulator.pointCount,
    centerLng,
    centerLat,
    radiusM: stationaryRadiusM(
      centerLng,
      centerLat,
      accumulator.minLng,
      accumulator.maxLng,
      accumulator.minLat,
      accumulator.maxLat
    ),
    netDistanceM: haversineMeters(
      [accumulator.firstPoint.lng, accumulator.firstPoint.lat],
      [accumulator.lastPoint.lng, accumulator.lastPoint.lat]
    ),
    pathDistanceM: accumulator.pathDistanceM,
    durationMs:
      firstTimestamp != null && lastTimestamp != null
        ? lastTimestamp - firstTimestamp
        : 0,
    medianSpeedMps: median(accumulator.speeds) ?? Infinity,
    recordedCount: accumulator.recordedCount,
    slowRecordedCount: accumulator.slowRecordedCount,
  }
}

function stationaryShapeIsSmall(summary: StationarySummary): boolean {
  return (
    summary.pointCount >= 3 &&
    summary.radiusM <= PAUSE_DRIFT_MAX_RADIUS_M &&
    summary.netDistanceM <= PAUSE_DRIFT_MAX_NET_DISTANCE_M &&
    summary.medianSpeedMps <= PAUSE_DRIFT_MAX_MEDIAN_SPEED_MPS
  )
}

function stationarySummaryQualifies(summary: StationarySummary): boolean {
  if (!stationaryShapeIsSmall(summary)) return false
  if (summary.durationMs < PAUSE_DRIFT_MIN_DURATION_MS) return false
  const pathEvidence =
    summary.pathDistanceM >= PAUSE_DRIFT_MIN_PATH_DISTANCE_M &&
    summary.pathDistanceM >=
      PAUSE_DRIFT_PATH_TO_NET_RATIO *
        Math.max(summary.netDistanceM, PAUSE_DRIFT_MAX_NET_DISTANCE_M - 5)
  const recordedCoverage = summary.recordedCount / summary.pointCount
  const sensorEvidence =
    recordedCoverage >= 0.5 &&
    summary.slowRecordedCount / summary.recordedCount >= 0.8
  return pathEvidence || sensorEvidence
}

function mergeStationarySummaries(
  first: StationarySummary,
  second: StationarySummary,
  path: readonly AnomalyPoint[],
  context: AnalysisContext
): StationarySummary | null {
  const boundaryFirst = path[first.endIndex]
  const boundarySecond = path[second.startIndex]
  if (!boundaryFirst || !boundarySecond) return null
  const boundaryEdge = classifyEdge(
    boundaryFirst,
    boundarySecond,
    { distances: [], deltas: [], accuracies: [] },
    context
  )
  if (
    !isReliableEdge(boundaryFirst, boundarySecond, boundaryEdge, {
      distances: [],
      deltas: [],
      accuracies: [],
    })
  ) {
    return null
  }
  const centerDistance = haversineMeters(
    [first.centerLng, first.centerLat],
    [second.centerLng, second.centerLat]
  )
  if (centerDistance > PAUSE_DRIFT_MAX_RADIUS_M) return null
  const pointCount = first.pointCount + second.pointCount
  const centerLng =
    (first.centerLng * first.pointCount +
      second.centerLng * second.pointCount) /
    pointCount
  const centerLat =
    (first.centerLat * first.pointCount +
      second.centerLat * second.pointCount) /
    pointCount
  const boundaryDistance = haversineMeters(
    [boundaryFirst.lng, boundaryFirst.lat],
    [boundarySecond.lng, boundarySecond.lat]
  )
  const firstTimestamp = finiteTimestamp(path[first.startIndex])
  const lastTimestamp = finiteTimestamp(path[second.endIndex])
  return {
    startIndex: first.startIndex,
    endIndex: second.endIndex,
    pointCount,
    centerLng,
    centerLat,
    radiusM: Math.max(
      first.radiusM +
        haversineMeters(
          [first.centerLng, first.centerLat],
          [centerLng, centerLat]
        ),
      second.radiusM +
        haversineMeters(
          [second.centerLng, second.centerLat],
          [centerLng, centerLat]
        )
    ),
    netDistanceM: haversineMeters(
      [path[first.startIndex]!.lng, path[first.startIndex]!.lat],
      [path[second.endIndex]!.lng, path[second.endIndex]!.lat]
    ),
    pathDistanceM:
      first.pathDistanceM + boundaryDistance + second.pathDistanceM,
    durationMs:
      firstTimestamp != null && lastTimestamp != null
        ? lastTimestamp - firstTimestamp
        : first.durationMs + second.durationMs,
    medianSpeedMps: Math.max(first.medianSpeedMps, second.medianSpeedMps),
    recordedCount: first.recordedCount + second.recordedCount,
    slowRecordedCount: first.slowRecordedCount + second.slowRecordedCount,
  }
}

function findPauseRangesV3(
  path: readonly AnomalyPoint[],
  context: AnalysisContext
): PauseRange[] {
  const ranges: PauseRange[] = []
  let activeSummary: StationarySummary | null = null
  let accumulator: StationaryAccumulator | null = null

  const flushActive = () => {
    if (activeSummary && stationarySummaryQualifies(activeSummary)) {
      ranges.push({
        startIndex: activeSummary.startIndex,
        endIndex: activeSummary.endIndex,
      })
    }
    activeSummary = null
  }

  const pushSummary = (summary: StationarySummary) => {
    if (!stationaryShapeIsSmall(summary)) {
      flushActive()
      return
    }
    if (!activeSummary) {
      activeSummary = summary
      return
    }
    const merged = mergeStationarySummaries(
      activeSummary,
      summary,
      path,
      context
    )
    if (merged) {
      activeSummary = merged
    } else {
      flushActive()
      activeSummary = summary
    }
  }

  const flushAccumulator = () => {
    if (!accumulator) return
    if (accumulator.pointCount >= 3) {
      pushSummary(summarizeStationaryAccumulator(accumulator))
    } else {
      flushActive()
    }
    accumulator = null
  }

  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!
    if (finiteTimestamp(point) == null) {
      flushAccumulator()
      flushActive()
      accumulator = null
      continue
    }
    if (!accumulator) {
      accumulator = newStationaryAccumulator(point, index)
      context.work.pauseWindowPointsVisited += 1
      continue
    }
    const previous = path[index - 1]!
    const previousTimestamp = finiteTimestamp(previous)
    const timestamp = finiteTimestamp(point)
    const deltaMs =
      previousTimestamp != null && timestamp != null
        ? timestamp - previousTimestamp
        : null
    if (deltaMs == null || deltaMs <= 0 || deltaMs > TIME_GAP_CEILING_MS) {
      flushAccumulator()
      flushActive()
      accumulator = newStationaryAccumulator(point, index)
      context.work.pauseWindowPointsVisited += 1
      continue
    }
    const unwrappedLng = unwrapLongitude(
      accumulator.previousUnwrappedLng,
      point.lng
    )
    const nextPointCount = accumulator.pointCount + 1
    const nextCenterLng = (accumulator.sumLng + unwrappedLng) / nextPointCount
    const nextCenterLat = (accumulator.sumLat + point.lat) / nextPointCount
    const nextRadiusM = stationaryRadiusM(
      nextCenterLng,
      nextCenterLat,
      Math.min(accumulator.minLng, unwrappedLng),
      Math.max(accumulator.maxLng, unwrappedLng),
      Math.min(accumulator.minLat, point.lat),
      Math.max(accumulator.maxLat, point.lat)
    )
    const nextNetDistanceM = haversineMeters(
      [accumulator.firstPoint.lng, accumulator.firstPoint.lat],
      [point.lng, point.lat]
    )
    if (
      nextRadiusM > PAUSE_DRIFT_MAX_RADIUS_M ||
      nextNetDistanceM > PAUSE_DRIFT_MAX_NET_DISTANCE_M
    ) {
      flushAccumulator()
      accumulator = newStationaryAccumulator(point, index)
      context.work.pauseWindowPointsVisited += 1
      continue
    }
    addStationaryPoint(accumulator, point, index, previous, context)
    if (accumulator.pointCount >= PAUSE_DRIFT_MAX_WINDOW_POINTS) {
      flushAccumulator()
    }
  }
  flushAccumulator()
  flushActive()
  return ranges
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
          { distances: [], deltas: [], accuracies: [] },
          context
        )
      : evidenceForPoint({ distances: [], deltas: [], accuracies: [] }, context)
  recordRemoval(counts, {
    sourcePathIndex: path.sourcePathIndex,
    points: path.points,
    startIndex: interiorStart,
    endIndex: Math.max(interiorStart, interiorEnd),
    code: "pause_drift",
    entry,
    triggerCode: "pause_drift",
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
  })
  void examples
}

function applyPauseDriftCleanup(
  paths: EmittedPath[],
  context: AnalysisContext,
  counts: MutableCounts,
  examples: GpsAnomalyExample[]
): EmittedPath[] {
  const cleaned: EmittedPath[] = []
  for (const path of paths) {
    const ranges = findPauseRangesV3(path.points, context)
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
      }
      cursor = range.endIndex
    }
    const after = path.points.slice(cursor)
    if (after.length >= MIN_RETAINED_PATH_POINTS) {
      cleaned.push({ sourcePathIndex: path.sourcePathIndex, points: after })
    }
  }
  return cleaned
}

interface NormalizedRemovalRange {
  sourcePathIndex: number
  startPointIndex: number
  endPointIndex: number
  removedPointCount: number
  record: RemovalRecord
}

function removalPriority(code: GpsAnomalyCode): number {
  switch (code) {
    case "invalid_coordinate":
      return 100
    case "untrusted_accuracy":
      return 95
    case "relative_accuracy_outlier":
      return 90
    case "isolated_fix":
      return 85
    case "untrusted_island":
      return 80
    case "local_spike":
      return 75
    case "local_excursion":
      return 74
    case "pause_drift":
      return 70
    case "untrusted_prefix":
    case "untrusted_suffix":
      return 30
    case "dropped_short_path":
      return 10
    default:
      return 0
  }
}

function sourcePointIndexAt(record: RemovalRecord, index: number): number {
  return record.points[index]?.sourcePointIndex ?? index
}

function removalBounds(record: RemovalRecord): {
  startPointIndex: number
  endPointIndex: number
} {
  const startPointIndex = sourcePointIndexAt(record, record.startIndex)
  const endPointIndex = sourcePointIndexAt(record, record.endIndex)
  return {
    startPointIndex: Math.min(startPointIndex, endPointIndex),
    endPointIndex: Math.max(startPointIndex, endPointIndex),
  }
}

function pointKey(sourcePathIndex: number, sourcePointIndex: number): string {
  return `${sourcePathIndex}:${sourcePointIndex}`
}

function countUnretainedInRange(
  source: AnomalySourcePath | undefined,
  sourcePathIndex: number,
  startPointIndex: number,
  endPointIndex: number,
  retainedKeys: ReadonlySet<string>
): number {
  if (!source) return 0
  return source.points.filter((point) => {
    const sourceIndex = point.sourcePointIndex
    return (
      sourceIndex >= startPointIndex &&
      sourceIndex <= endPointIndex &&
      !retainedKeys.has(pointKey(sourcePathIndex, sourceIndex))
    )
  }).length
}

function normalizeRemovalRanges(
  sourcePaths: readonly AnomalySourcePath[],
  cleanedPaths: readonly EmittedPath[],
  counts: MutableCounts,
  context: AnalysisContext
): NormalizedRemovalRange[] {
  const sourceByPath = new Map(
    sourcePaths.map((source) => [source.sourcePathIndex, source] as const)
  )
  const retainedKeys = new Set<string>()
  for (const path of cleanedPaths) {
    for (const point of path.points) {
      retainedKeys.add(pointKey(path.sourcePathIndex, point.sourcePointIndex))
    }
  }

  const coveredKeys = new Set<string>()
  for (const record of counts.removalRecords) {
    const start = Math.max(0, record.startIndex)
    const end = Math.min(record.points.length - 1, record.endIndex)
    for (let index = start; index <= end; index += 1) {
      coveredKeys.add(
        pointKey(record.sourcePathIndex, record.points[index]!.sourcePointIndex)
      )
    }
  }

  const records = [...counts.removalRecords]
  for (const source of sourcePaths) {
    let missingStart = -1
    const flushMissing = (endIndex: number) => {
      if (missingStart === -1) return
      const missingEnd = endIndex
      const first = source.points[missingStart]!
      const last = source.points[missingEnd]!
      records.push({
        sourcePathIndex: source.sourcePathIndex,
        points: source.points,
        startIndex: missingStart,
        endIndex: missingEnd,
        code: "dropped_short_path",
        entry: evidenceForPoint(
          { distances: [], deltas: [], accuracies: [] },
          context
        ),
        order: Number.MAX_SAFE_INTEGER + records.length,
      })
      void first
      void last
      missingStart = -1
    }
    for (let index = 0; index < source.points.length; index += 1) {
      const point = source.points[index]!
      const key = pointKey(source.sourcePathIndex, point.sourcePointIndex)
      const isMissing = !retainedKeys.has(key) && !coveredKeys.has(key)
      if (isMissing && missingStart === -1) missingStart = index
      if (!isMissing && missingStart !== -1) flushMissing(index - 1)
    }
    if (missingStart !== -1) flushMissing(source.points.length - 1)
  }

  const sorted = records
    .map((record) => ({ record, ...removalBounds(record) }))
    .sort(
      (a, b) =>
        a.record.sourcePathIndex - b.record.sourcePathIndex ||
        a.startPointIndex - b.startPointIndex ||
        a.endPointIndex - b.endPointIndex ||
        a.record.order - b.record.order
    )

  const merged: Array<{
    sourcePathIndex: number
    startPointIndex: number
    endPointIndex: number
    record: RemovalRecord
  }> = []
  for (const item of sorted) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.sourcePathIndex === item.record.sourcePathIndex &&
      item.startPointIndex <= previous.endPointIndex
    ) {
      previous.startPointIndex = Math.min(
        previous.startPointIndex,
        item.startPointIndex
      )
      previous.endPointIndex = Math.max(
        previous.endPointIndex,
        item.endPointIndex
      )
      previous.record.isPrefix =
        previous.record.isPrefix || item.record.isPrefix
      previous.record.isSuffix =
        previous.record.isSuffix || item.record.isSuffix
      if (
        removalPriority(item.record.code) >
        removalPriority(previous.record.code)
      ) {
        previous.record = item.record
      }
    } else {
      merged.push({
        sourcePathIndex: item.record.sourcePathIndex,
        startPointIndex: item.startPointIndex,
        endPointIndex: item.endPointIndex,
        record: item.record,
      })
    }
  }

  return merged.map((item) => ({
    ...item,
    removedPointCount: countUnretainedInRange(
      sourceByPath.get(item.sourcePathIndex),
      item.sourcePathIndex,
      item.startPointIndex,
      item.endPointIndex,
      retainedKeys
    ),
  }))
}

function finalizeDiagnostics(
  sourcePaths: readonly AnomalySourcePath[],
  cleanedPaths: readonly EmittedPath[],
  counts: MutableCounts,
  context: AnalysisContext
): {
  examples: GpsAnomalyExample[]
  reasons: Partial<Record<GpsAnomalyCode, number>>
  splitCount: number
  gapSplitCount: number
  removalSplitCount: number
  trimmedPrefixPoints: number
  trimmedSuffixPoints: number
  mergedRemovalRangeCount: number
} {
  const removals = normalizeRemovalRanges(
    sourcePaths,
    cleanedPaths,
    counts,
    context
  )
  context.work.mergedRemovalRangeCount = removals.length
  const reasons: Partial<Record<GpsAnomalyCode, number>> = {}
  const increment = (code: GpsAnomalyCode) => {
    reasons[code] = (reasons[code] ?? 0) + 1
  }
  for (const split of counts.splitRecords) increment(split.code)
  for (const removal of removals) increment(removal.record.code)

  const examples: GpsAnomalyExample[] = []
  const events = [
    ...counts.splitRecords.map((split) => ({ type: "split" as const, split })),
    ...removals.map((removal) => ({ type: "remove" as const, removal })),
  ].sort((a, b) => {
    const left = a.type === "split" ? a.split.order : a.removal.record.order
    const right = b.type === "split" ? b.split.order : b.removal.record.order
    return left - right
  })
  for (const event of events) {
    if (examples.length >= MAX_RELIABILITY_EXAMPLES) break
    if (event.type === "split") {
      examples.push(
        makeExample(
          event.split.code,
          "split",
          event.split.sourcePathIndex,
          event.split.points,
          event.split.startIndex,
          event.split.endIndex,
          event.split.entry,
          context,
          {
            triggerCode: event.split.triggerCode,
            removedPointCount: 0,
          }
        )
      )
    } else {
      const { record } = event.removal
      examples.push(
        makeExample(
          record.code,
          "remove",
          event.removal.sourcePathIndex,
          record.points,
          record.startIndex,
          record.endIndex,
          record.entry,
          context,
          {
            triggerCode: record.triggerCode,
            removedPointCount: event.removal.removedPointCount,
            startPointIndex: event.removal.startPointIndex,
            endPointIndex: event.removal.endPointIndex,
            rejoinPointIndex: record.rejoinPointIndex,
            rejoin: record.rejoin,
          }
        )
      )
    }
  }

  const removalSplits = removals.filter(
    ({ record }) =>
      record.code !== "untrusted_prefix" && record.code !== "untrusted_suffix"
  )
  return {
    examples,
    reasons,
    splitCount: counts.splitRecords.length + removalSplits.length,
    gapSplitCount: counts.splitRecords.filter(
      (split) => split.code === "recording_gap"
    ).length,
    removalSplitCount: removalSplits.length,
    trimmedPrefixPoints: removals
      .filter(({ record }) => record.isPrefix)
      .reduce((total, range) => total + range.removedPointCount, 0),
    trimmedSuffixPoints: removals
      .filter(({ record }) => record.isSuffix)
      .reduce((total, range) => total + range.removedPointCount, 0),
    mergedRemovalRangeCount: removals.length,
  }
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
      candidatePointsVisited: 0,
      fragmentPromotions: 0,
      mergedRemovalRangeCount: 0,
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
    removalRecords: [],
    splitRecords: [],
    nextDecisionOrder: 0,
  }
  const examples: GpsAnomalyExample[] = []
  const analyzedPaths: EmittedPath[] = []

  for (const source of sourcePaths) {
    context.work.pointsVisited += source.points.length
    const baseline: RollingBaseline = {
      distances: [],
      deltas: [],
      accuracies: [],
    }
    let validPoints: AnomalyPoint[] = []
    let invalidPoints: AnomalyPoint[] = []
    const flushValid = () => {
      if (validPoints.length > 0) {
        analyzedPaths.push(
          ...analyzeValidSegmentV3(
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
  const removedPoints = counts.inputPoints - retainedPoints
  const diagnostics = finalizeDiagnostics(
    sourcePaths,
    cleanedPaths,
    counts,
    context
  )
  const hasDecision = Object.keys(diagnostics.reasons).length > 0
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
      splitCount: diagnostics.splitCount,
      gapSplitCount: diagnostics.gapSplitCount,
      removalSplitCount: diagnostics.removalSplitCount,
      trimmedPrefixPoints: diagnostics.trimmedPrefixPoints,
      trimmedSuffixPoints: diagnostics.trimmedSuffixPoints,
      reasons: diagnostics.reasons,
    },
    examples: diagnostics.examples,
    work: context.work,
  }
}

/** Descriptive alias for callers that treat the module as an import cleaner. */
export const cleanGpsAnomalies = detectGpsAnomalies

export { ANOMALY_ALGORITHM_VERSION }
