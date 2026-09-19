import { performance } from "node:perf_hooks"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
} from "../app/lib/activities/gpsAnomalies"
import { buildGpsAnomalyReport } from "../app/lib/activities/gpsAnomalyDebug"
import { computeActivityStatsForPaths } from "../app/lib/stats"

const TIERS = [1_000, 10_000, 100_000, 250_000]
const WARMUP_RUNS = 2
const MEASURED_RUNS = 5
const STEP_DEGREES = 0.00001

type ScenarioName =
  | "clean"
  | "alternating_spike"
  | "long_quarantined_suffix"
  | "missing_time"
  | "repeated_return"

interface BenchmarkSample {
  scenario: ScenarioName
  pointCount: number
  medianMs: number
  p95Ms: number
  parseAndReportMedianMs: number
  parseAndReportP95Ms: number
  status: ReturnType<typeof detectGpsAnomalies>["status"]
  inputPoints: number
  retainedPoints: number
  removedPoints: number
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

interface BenchmarkRun {
  result: ReturnType<typeof detectGpsAnomalies>
  detectorDurationMs: number
  parseAndReportDurationMs: number
}

function point(
  sourcePointIndex: number,
  lng: number,
  timestampMs?: number
): AnomalyPoint {
  return {
    sourcePointIndex,
    lng,
    lat: 0,
    ...(timestampMs == null ? {} : { timestampMs }),
  }
}

function timestampedPath(
  pointCount: number,
  spikePeriod: number
): AnomalyPoint[] {
  const points: AnomalyPoint[] = []
  let longitude = 0
  for (let index = 0; index < pointCount; index += 1) {
    const phase = index % spikePeriod
    if (phase === spikePeriod - 3) {
      points.push(point(index, longitude + 0.1, index * 1_000))
    } else if (phase === spikePeriod - 2) {
      points.push(point(index, longitude + STEP_DEGREES * 2, index * 1_000))
      longitude += STEP_DEGREES * 2
    } else {
      points.push(point(index, longitude, index * 1_000))
      longitude += STEP_DEGREES
    }
  }
  return points
}

function scenarioPoints(
  scenario: ScenarioName,
  pointCount: number
): AnomalyPoint[] {
  if (scenario === "clean") {
    return Array.from({ length: pointCount }, (_, index) =>
      point(index, index * STEP_DEGREES, index * 1_000)
    )
  }
  if (scenario === "alternating_spike") {
    return timestampedPath(pointCount, 32)
  }
  if (scenario === "repeated_return") {
    return timestampedPath(pointCount, 8)
  }
  if (scenario === "long_quarantined_suffix") {
    const points: AnomalyPoint[] = []
    const trustedCount = Math.max(5, Math.floor(pointCount / 2))
    for (let index = 0; index < pointCount; index += 1) {
      const longitude =
        index < trustedCount
          ? index * STEP_DEGREES
          : 10 + (index - trustedCount) * STEP_DEGREES
      points.push(point(index, longitude, index * 1_000))
    }
    return points
  }

  const points: AnomalyPoint[] = []
  let longitude = 0
  for (let index = 0; index < pointCount; index += 1) {
    const phase = index % 32
    if (phase === 16) {
      points.push(point(index, longitude + 1, undefined))
    } else if (phase === 17) {
      points.push(point(index, longitude + STEP_DEGREES, undefined))
      longitude += STEP_DEGREES
    } else {
      points.push(point(index, longitude, undefined))
      longitude += STEP_DEGREES
    }
  }
  return points
}

function makeSource(
  scenario: ScenarioName,
  pointCount: number
): AnomalySourcePath[] {
  return [
    {
      sourcePathIndex: 0,
      points: scenarioPoints(scenario, pointCount),
    },
  ]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * percentileValue) - 1
  )
  return sorted[Math.max(0, index)]!
}

function parseAndReport(sourcePaths: AnomalySourcePath[]): BenchmarkRun {
  const parseStartedAt = performance.now()
  const detectorStartedAt = performance.now()
  const result = detectGpsAnomalies(sourcePaths, { activityType: "cycling" })
  const detectorDurationMs = performance.now() - detectorStartedAt

  if (result.status === "rejected") {
    buildGpsAnomalyReport({
      result,
      format: "gpx",
      activityType: "cycling",
      sourcePaths,
      afterStats: null,
      detectorDurationMs,
    })
  } else {
    const stats = computeActivityStatsForPaths(result.paths)
    const afterStats = { ...stats, uniqueDistanceKm: stats.distanceKm }
    if (result.status === "cleaned") {
      buildGpsAnomalyReport({
        result,
        format: "gpx",
        activityType: "cycling",
        sourcePaths,
        afterStats,
        detectorDurationMs,
      })
    }
  }

  return {
    result,
    detectorDurationMs,
    parseAndReportDurationMs: performance.now() - parseStartedAt,
  }
}

function measure(scenario: ScenarioName, pointCount: number): BenchmarkSample {
  const sourcePaths = makeSource(scenario, pointCount)
  const detectorTimings: number[] = []
  const parseAndReportTimings: number[] = []
  let lastRun: BenchmarkRun | undefined
  for (
    let iteration = 0;
    iteration < WARMUP_RUNS + MEASURED_RUNS;
    iteration += 1
  ) {
    const measured = parseAndReport(sourcePaths)
    if (iteration >= WARMUP_RUNS) {
      detectorTimings.push(measured.detectorDurationMs)
      parseAndReportTimings.push(measured.parseAndReportDurationMs)
    }
    lastRun = measured
  }
  if (!lastRun) throw new Error("benchmark did not produce a result")
  return {
    scenario,
    pointCount,
    medianMs: median(detectorTimings),
    p95Ms: percentile(detectorTimings, 0.95),
    parseAndReportMedianMs: median(parseAndReportTimings),
    parseAndReportP95Ms: percentile(parseAndReportTimings, 0.95),
    status: lastRun.result.status,
    inputPoints: lastRun.result.counts.inputPoints,
    retainedPoints: lastRun.result.counts.retainedPoints,
    removedPoints: lastRun.result.counts.removedPoints,
    distanceCalculations: lastRun.result.work.distanceCalculations,
    pointsVisited: lastRun.result.work.pointsVisited,
    boundedLookaheadCount: lastRun.result.work.boundedLookaheadCount,
    candidatePointsVisited: lastRun.result.work.candidatePointsVisited,
    fragmentPromotions: lastRun.result.work.fragmentPromotions,
    mergedRemovalRangeCount: lastRun.result.work.mergedRemovalRangeCount,
    maxDistanceWindowSize: lastRun.result.work.maxDistanceWindowSize,
    maxTimeWindowSize: lastRun.result.work.maxTimeWindowSize,
    pauseWindowPointsVisited: lastRun.result.work.pauseWindowPointsVisited,
  }
}

const scenarios: ScenarioName[] = [
  "clean",
  "alternating_spike",
  "long_quarantined_suffix",
  "missing_time",
  "repeated_return",
]

const samples = scenarios.flatMap((scenario) =>
  TIERS.map((pointCount) => measure(scenario, pointCount))
)

console.log(
  JSON.stringify(
    {
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      activityType: "cycling",
      samples,
    },
    null,
    2
  )
)
