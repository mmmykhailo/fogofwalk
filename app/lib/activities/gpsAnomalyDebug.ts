import type {
  ActivityFormat,
  RawPoint,
  ActivityStats,
  ActivityType,
} from "~shared/activities"
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
  PAUSE_DRIFT_MAX_WINDOW_POINTS,
  REJOIN_CONFIRMATION_EDGES,
  REJOIN_POSITION_CEILING_M,
  REJOIN_POSITION_FLOOR_M,
  RELIABILITY_MIN_BASELINE_EDGES,
  RELIABILITY_WINDOW_EDGES,
  SPEED_TEST_DISTANCE_FLOOR_M,
  TIME_GAP_CEILING_MS,
  TIME_GAP_FLOOR_MS,
  TIME_GAP_MULTIPLIER,
  maxPlausibleSpeed,
} from "~/constants/activityAnomalies"
import {
  MOVING_TIME_MIN_SPEED_KMH,
  MOVING_TIME_STOPPED_GAP_MS,
} from "~/constants/fog"
import type {
  AnomalySourcePath,
  GpsAnomalyExample,
  GpsAnomalyResult,
} from "~/lib/activities/gpsAnomalies"
import { haversineKm } from "~/lib/stats"
import type {
  GpsAnomalyReport,
  GpsAnomalyStatsSummary,
} from "~/lib/parsers/types"

export interface GpsAnomalyReportInput {
  result: GpsAnomalyResult
  format: ActivityFormat
  activityType?: ActivityType
  sourcePaths: readonly AnomalySourcePath[]
  afterStats: ActivityStats | null
  detectorDurationMs: number
}

function isUsablePoint(point: RawPoint): boolean {
  return (
    Number.isFinite(point.lng) &&
    Number.isFinite(point.lat) &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    point.lat >= -90 &&
    point.lat <= 90
  )
}

/**
 * Compute only the scalar values needed for the pre-clean console report.
 * Unlike persisted activity statistics, this deliberately does not build an
 * elevation profile or run elevation smoothing.
 */
export function computeGpsAnomalyStatsSummary(
  sourcePaths: readonly AnomalySourcePath[]
): GpsAnomalyStatsSummary {
  let distanceKm = 0
  let movingTimeMs = 0
  let hasTimestamps = false
  let hasRenderablePath = false
  let firstTimestampMs: number | null = null
  let lastTimestampMs: number | null = null

  for (const source of sourcePaths) {
    let previous: RawPoint | undefined
    let pointCount = 0
    let pathDistanceKm = 0
    let pathMovingTimeMs = 0
    let pathHasTimestamps = false
    let pathFirstTimestampMs: number | null = null
    let pathLastTimestampMs: number | null = null

    const finishPath = () => {
      if (pointCount >= 2) {
        distanceKm += pathDistanceKm
        if (pathHasTimestamps) {
          hasTimestamps = true
          movingTimeMs += pathMovingTimeMs
        }
        if (!hasRenderablePath) {
          firstTimestampMs = pathFirstTimestampMs
          hasRenderablePath = true
        }
        lastTimestampMs = pathLastTimestampMs
      }
      previous = undefined
      pointCount = 0
      pathDistanceKm = 0
      pathMovingTimeMs = 0
      pathHasTimestamps = false
      pathFirstTimestampMs = null
      pathLastTimestampMs = null
    }

    for (const point of source.points) {
      if (!isUsablePoint(point)) {
        finishPath()
        continue
      }

      if (pointCount === 0) {
        pathFirstTimestampMs =
          point.timestampMs != null ? point.timestampMs : null
      } else if (previous) {
        const segmentDistanceKm = haversineKm(
          previous.lng,
          previous.lat,
          point.lng,
          point.lat
        )
        pathDistanceKm += segmentDistanceKm
        if (previous.timestampMs != null && point.timestampMs != null) {
          pathHasTimestamps = true
          const deltaMs = point.timestampMs - previous.timestampMs
          if (deltaMs > 0 && deltaMs <= MOVING_TIME_STOPPED_GAP_MS) {
            const segmentSpeedKmh = segmentDistanceKm / (deltaMs / 3_600_000)
            if (segmentSpeedKmh >= MOVING_TIME_MIN_SPEED_KMH) {
              pathMovingTimeMs += deltaMs
            }
          }
        }
      }
      pathLastTimestampMs = point.timestampMs != null ? point.timestampMs : null
      pointCount += 1
      previous = point
    }
    finishPath()
  }

  return {
    distanceKm,
    durationMs:
      hasRenderablePath && firstTimestampMs != null && lastTimestampMs != null
        ? lastTimestampMs - firstTimestampMs
        : null,
    movingTimeMs: hasTimestamps ? movingTimeMs : null,
  }
}

function timestampPointCount(
  sourcePaths: readonly AnomalySourcePath[]
): number {
  return sourcePaths.reduce(
    (total, source) =>
      total +
      source.points.filter(
        (point) =>
          point.timestampMs != null && Number.isFinite(point.timestampMs)
      ).length,
    0
  )
}

function nonPositiveTimestampCount(
  sourcePaths: readonly AnomalySourcePath[]
): number {
  let count = 0
  for (const source of sourcePaths) {
    for (let index = 1; index < source.points.length; index += 1) {
      const previous = source.points[index - 1]!.timestampMs
      const current = source.points[index]!.timestampMs
      if (
        previous != null &&
        current != null &&
        Number.isFinite(previous) &&
        Number.isFinite(current) &&
        current <= previous
      ) {
        count += 1
      }
    }
  }
  return count
}

export function buildGpsAnomalyReport(
  input: GpsAnomalyReportInput
): GpsAnomalyReport {
  const { result } = input
  return {
    status: result.status,
    counts: result.counts,
    examples: result.examples,
    work: result.work,
    format: input.format,
    ...(input.activityType ? { activityType: input.activityType } : {}),
    sourcePathCount: input.sourcePaths.length,
    timestampPointCount: timestampPointCount(input.sourcePaths),
    nonPositiveTimestampCount: nonPositiveTimestampCount(input.sourcePaths),
    emittedPathCount: result.paths.length,
    beforeStats: computeGpsAnomalyStatsSummary(input.sourcePaths),
    afterStats: input.afterStats,
    detectorDurationMs: input.detectorDurationMs,
  }
}

function statsSummary(
  stats: Pick<
    ActivityStats,
    "distanceKm" | "durationMs" | "movingTimeMs"
  > | null
) {
  if (!stats) return null
  return {
    distanceKm: stats.distanceKm,
    durationMs: stats.durationMs,
    movingTimeMs: stats.movingTimeMs,
  }
}

function differenceOrNull(
  after: number | null,
  before: number | null
): number | null {
  return after == null || before == null ? null : after - before
}

function removalCount(report: GpsAnomalyReport): number {
  return Object.entries(report.counts.reasons).reduce(
    (total, [code, count]) =>
      code === "recording_gap" ||
      code === "non_positive_time" ||
      code === "dropped_short_path"
        ? total
        : total + (count ?? 0),
    0
  )
}

function removalEvidence(example: GpsAnomalyExample) {
  return {
    sourcePathIndex: example.sourcePathIndex,
    pointIndexes: [example.startPointIndex, example.endPointIndex],
    removedPointCount:
      example.endPointIndex >= example.startPointIndex
        ? example.endPointIndex - example.startPointIndex + 1
        : 0,
    entryDistanceM: example.entryDistanceM,
    entryDeltaMs: example.entryDeltaMs,
    entrySpeedMps: example.entrySpeedMps,
    distanceLimitM: example.distanceLimitM,
    effectiveDistanceLimitM: example.effectiveDistanceLimitM,
    timeGapLimitMs: example.timeGapLimitMs,
    trustedDistanceSamples: example.trustedDistanceSamples,
    trustedTimeSamples: example.trustedTimeSamples,
    triggerCode: example.triggerCode ?? null,
    exitEdgeImpossible: example.rejoinPointIndex != null,
    rejoinDistanceFromLastTrustedM: example.rejoinDistanceFromLastTrustedM,
    rejoinElapsedMs: example.rejoinElapsedMs,
  }
}

function removalDecision(example: GpsAnomalyExample) {
  return {
    classification: example.code,
    rejoin:
      example.rejoinPointIndex == null
        ? "eof_trim"
        : { pointIndex: example.rejoinPointIndex },
    outputPathBoundary: {
      beforeEndPointIndex: Math.max(0, example.startPointIndex - 1),
      afterStartPointIndex: example.rejoinPointIndex,
    },
  }
}

/**
 * Emit one bounded, coordinate-free diagnostic group for an affected import.
 * This is the only module that writes GPS anomaly diagnostics to the console.
 */
export function logGpsAnomalyReport(input: {
  fileName: string
  activityIndex: number
  report: GpsAnomalyReport
}): void {
  const { report } = input
  if (report.status === "clean") return

  console.groupCollapsed(
    `[gps-anomaly] ${input.fileName} / activity ${input.activityIndex + 1}: ${report.status}`
  )
  try {
    console.debug("input", {
      format: report.format,
      activityType: report.activityType ?? "unknown",
      sourcePathCount: report.sourcePathCount,
      pointCount: report.counts.inputPoints,
      timestampCoverage: {
        points: report.timestampPointCount,
        total: report.counts.inputPoints,
      },
      nonPositiveTimestampCount: report.nonPositiveTimestampCount,
    })
    console.debug("configuration", {
      algorithmVersion: ANOMALY_ALGORITHM_VERSION,
      reliabilityWindowEdges: RELIABILITY_WINDOW_EDGES,
      minimumBaselineEdges: RELIABILITY_MIN_BASELINE_EDGES,
      localDistanceFloorM: LOCAL_DISTANCE_FLOOR_M,
      localDistanceMultiplier: LOCAL_DISTANCE_MULTIPLIER,
      localDistanceCeilingM: LOCAL_DISTANCE_CEILING_M,
      timeGapFloorMs: TIME_GAP_FLOOR_MS,
      timeGapMultiplier: TIME_GAP_MULTIPLIER,
      timeGapCeilingMs: TIME_GAP_CEILING_MS,
      speedTestDistanceFloorM: SPEED_TEST_DISTANCE_FLOOR_M,
      maxTrustedGpsAccuracyM: MAX_TRUSTED_GPS_ACCURACY_M,
      gpsAccuracyMultiplier: GPS_ACCURACY_MULTIPLIER,
      applicableSpeedCeilingMps: maxPlausibleSpeed(report.activityType),
      hardTeleportDistanceM: HARD_TELEPORT_DISTANCE_M,
      confirmationEdges: REJOIN_CONFIRMATION_EDGES,
      rejoin: {
        floorM: REJOIN_POSITION_FLOOR_M,
        ceilingM: REJOIN_POSITION_CEILING_M,
      },
      minimumConfidentFragmentPoints: MIN_CONFIDENT_FRAGMENT_POINTS,
      pauseWindowMaxPoints: PAUSE_DRIFT_MAX_WINDOW_POINTS,
      maximumExamples: MAX_RELIABILITY_EXAMPLES,
    })
    report.examples.forEach((example, index) => {
      console.groupCollapsed(
        `removal ${index + 1}: ${example.code} [` +
          `${example.startPointIndex}..${example.endPointIndex}]`
      )
      try {
        console.debug("evidence", removalEvidence(example))
        console.debug("decision", removalDecision(example))
      } finally {
        console.groupEnd()
      }
    })
    console.debug("output", {
      inputPoints: report.counts.inputPoints,
      retainedPoints: report.counts.retainedPoints,
      removedPoints: report.counts.removedPoints,
      sourcePathCount: report.sourcePathCount,
      emittedPathCount: report.emittedPathCount,
      splitCount: report.counts.splitCount,
      gapSplitCount: report.counts.gapSplitCount,
      removalSplitCount: report.counts.removalSplitCount,
      trimmedPrefixPoints: report.counts.trimmedPrefixPoints,
      trimmedSuffixPoints: report.counts.trimmedSuffixPoints,
      omittedExampleCount: Math.max(
        0,
        removalCount(report) -
          Math.min(MAX_RELIABILITY_EXAMPLES, report.examples.length)
      ),
    })
    console.debug("statistics", {
      before: statsSummary(report.beforeStats),
      after: statsSummary(report.afterStats),
      delta:
        report.afterStats == null
          ? null
          : {
              distanceKm:
                report.afterStats.distanceKm - report.beforeStats.distanceKm,
              durationMs: differenceOrNull(
                report.afterStats.durationMs,
                report.beforeStats.durationMs
              ),
              movingTimeMs: differenceOrNull(
                report.afterStats.movingTimeMs,
                report.beforeStats.movingTimeMs
              ),
            },
      cleanedElevationGainM: report.afterStats?.elevationGainM ?? null,
      cleanedElevationLossM: report.afterStats?.elevationLossM ?? null,
    })
    console.debug("performance", {
      detectorWallTimeMs: report.detectorDurationMs,
      pointsVisited: report.work.pointsVisited,
      distanceCalculations: report.work.distanceCalculations,
      boundedLookaheadCount: report.work.boundedLookaheadCount,
      maxDistanceWindowSize: report.work.maxDistanceWindowSize,
      maxTimeWindowSize: report.work.maxTimeWindowSize,
      pauseWindowPointsVisited: report.work.pauseWindowPointsVisited,
    })
  } finally {
    console.groupEnd()
  }
}
