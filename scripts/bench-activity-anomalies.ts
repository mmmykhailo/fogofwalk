import { performance } from "node:perf_hooks"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
} from "../app/lib/activities/gpsAnomalies"

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
  status: ReturnType<typeof detectGpsAnomalies>["status"]
  inputPoints: number
  retainedPoints: number
  removedPoints: number
  distanceCalculations: number
  pointsVisited: number
  boundedLookaheadCount: number
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

function timestampedPath(pointCount: number, spikePeriod: number): AnomalyPoint[] {
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

function measure(scenario: ScenarioName, pointCount: number): BenchmarkSample {
  const sourcePaths = makeSource(scenario, pointCount)
  const timings: number[] = []
  let result: ReturnType<typeof detectGpsAnomalies> | undefined
  for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
    const startedAt = performance.now()
    result = detectGpsAnomalies(sourcePaths, { activityType: "cycling" })
    const elapsed = performance.now() - startedAt
    if (run >= WARMUP_RUNS) timings.push(elapsed)
  }
  if (!result) throw new Error("benchmark did not produce a result")
  return {
    scenario,
    pointCount,
    medianMs: median(timings),
    p95Ms: percentile(timings, 0.95),
    status: result.status,
    inputPoints: result.counts.inputPoints,
    retainedPoints: result.counts.retainedPoints,
    removedPoints: result.counts.removedPoints,
    distanceCalculations: result.work.distanceCalculations,
    pointsVisited: result.work.pointsVisited,
    boundedLookaheadCount: result.work.boundedLookaheadCount,
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
