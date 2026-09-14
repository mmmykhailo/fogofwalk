import type {
  ActivityFormat,
  RawPoint,
  ActivityStats,
  ActivityType,
} from "~shared/activities"
import {
  ABSOLUTE_TELEPORT_DISTANCE_M,
  ANOMALY_ALGORITHM_VERSION,
  MAX_ANOMALY_EXAMPLES,
  MIN_SPEED_TEST_DISTANCE_M,
  REJOIN_CONFIRMATION_EDGES,
  TRUSTED_PREFIX_MIN_POINTS,
  TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES,
  maxPlausibleSpeed,
} from "~/constants/activityAnomalies"
import type {
  AnomalySourcePath,
  GpsAnomalyExample,
  GpsAnomalyResult,
} from "~/lib/activities/gpsAnomalies"
import { computeActivityStatsForPaths } from "~/lib/stats"
import type { GpsAnomalyReport } from "~/lib/parsers/types"

export interface GpsAnomalyReportInput {
  result: GpsAnomalyResult
  format: ActivityFormat
  activityType?: ActivityType
  sourcePaths: readonly AnomalySourcePath[]
  afterStats: ActivityStats | null
  detectorDurationMs: number
}

function usableStatsPaths(
  sourcePaths: readonly AnomalySourcePath[]
): RawPoint[][] {
  const paths: RawPoint[][] = []
  for (const source of sourcePaths) {
    let current: RawPoint[] = []
    const flush = () => {
      if (current.length >= 2) paths.push(current)
      current = []
    }
    for (const point of source.points) {
      if (
        !Number.isFinite(point.lng) ||
        !Number.isFinite(point.lat) ||
        point.lng < -180 ||
        point.lng > 180 ||
        point.lat < -90 ||
        point.lat > 90
      ) {
        flush()
        continue
      }
      current.push(point)
    }
    flush()
  }
  return paths
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
  const before = computeActivityStatsForPaths(
    usableStatsPaths(input.sourcePaths)
  )
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
    beforeStats: {
      ...before,
      uniqueDistanceKm: before.distanceKm,
    },
    afterStats: input.afterStats,
    detectorDurationMs: input.detectorDurationMs,
  }
}

function statsSummary(stats: ActivityStats | null) {
  if (!stats) return null
  return {
    distanceKm: stats.distanceKm,
    durationMs: stats.durationMs,
    movingTimeMs: stats.movingTimeMs,
    elevationGainM: stats.elevationGainM,
    elevationLossM: stats.elevationLossM,
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
    (total, [, count]) => total + (count ?? 0),
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
      triggerFloorM: MIN_SPEED_TEST_DISTANCE_M,
      applicableSpeedCeilingMps: maxPlausibleSpeed(report.activityType),
      absoluteFallbackM: ABSOLUTE_TELEPORT_DISTANCE_M,
      confirmationEdges: REJOIN_CONFIRMATION_EDGES,
      trustedPrefix: {
        points: TRUSTED_PREFIX_MIN_POINTS,
        plausibleEdges: TRUSTED_PREFIX_MIN_PLAUSIBLE_EDGES,
      },
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
      omittedExampleCount: Math.max(
        0,
        removalCount(report) -
          Math.min(MAX_ANOMALY_EXAMPLES, report.examples.length)
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
    })
  } finally {
    console.groupEnd()
  }
}
