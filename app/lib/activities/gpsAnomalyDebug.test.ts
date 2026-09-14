import { afterEach, describe, expect, test } from "bun:test"
import type { ActivityStats } from "~shared/activities"
import { maxPlausibleSpeed } from "~/constants/activityAnomalies"
import { computeActivityStatsForPaths } from "~/lib/stats"
import {
  detectGpsAnomalies,
  type AnomalyPoint,
  type AnomalySourcePath,
  type GpsAnomalyResult,
} from "./gpsAnomalies"
import { buildGpsAnomalyReport, logGpsAnomalyReport } from "./gpsAnomalyDebug"

interface ConsoleCapture {
  groups: unknown[][]
  groupEnds: number
  debug: unknown[][]
  restore: () => void
}

let activeCapture: ConsoleCapture | null = null

function captureConsole(): ConsoleCapture {
  activeCapture?.restore()
  activeCapture = null
  const groups: unknown[][] = []
  const debug: unknown[][] = []
  const originalGroupCollapsed = console.groupCollapsed
  const originalGroupEnd = console.groupEnd
  const originalDebug = console.debug
  let groupEnds = 0
  console.groupCollapsed = ((...args: unknown[]) => {
    groups.push(args)
  }) as typeof console.groupCollapsed
  console.groupEnd = (() => {
    groupEnds += 1
  }) as typeof console.groupEnd
  console.debug = ((...args: unknown[]) => {
    debug.push(args)
  }) as typeof console.debug
  const capture: ConsoleCapture = {
    groups,
    get groupEnds() {
      return groupEnds
    },
    debug,
    restore: () => {
      console.groupCollapsed = originalGroupCollapsed
      console.groupEnd = originalGroupEnd
      console.debug = originalDebug
    },
  }
  activeCapture = capture
  return capture
}

afterEach(() => {
  activeCapture?.restore()
  activeCapture = null
})

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

function source(points: AnomalyPoint[]): AnomalySourcePath {
  return { sourcePathIndex: 0, points }
}

function statsFor(result: GpsAnomalyResult): ActivityStats {
  const stats = computeActivityStatsForPaths(result.paths)
  return { ...stats, uniqueDistanceKm: stats.distanceKm }
}

function reportFor(result: GpsAnomalyResult, sourcePaths: AnomalySourcePath[]) {
  return buildGpsAnomalyReport({
    result,
    format: "gpx",
    activityType: "cycling",
    sourcePaths,
    afterStats:
      result.status === "clean" || result.status === "cleaned"
        ? statsFor(result)
        : null,
    detectorDurationMs: 1.25,
  })
}

describe("GPS anomaly diagnostics", () => {
  test("keeps clean imports silent", () => {
    const capture = captureConsole()
    const sourcePaths = [source([point(0, 0, 0), point(0.0001, 0, 1_000)])]
    const result = detectGpsAnomalies(sourcePaths)

    logGpsAnomalyReport({
      fileName: "clean.gpx",
      activityIndex: 0,
      report: reportFor(result, sourcePaths),
    })

    expect(capture.groups).toEqual([])
    expect(capture.groupEnds).toBe(0)
    expect(capture.debug).toEqual([])
  })

  test("balances bounded groups and emits coordinate-free cleaned evidence", () => {
    const capture = captureConsole()
    const sourcePaths = [
      source(
        [0, 0.0001, 0.0002, 0.0003, 0.0004, 10, 0.0005, 0.0006, 0.0007].map(
          (lng, index) => point(index, lng, index * 1_000)
        )
      ),
    ]
    const result = detectGpsAnomalies(sourcePaths, { activityType: "cycling" })
    const report = reportFor(result, sourcePaths)

    logGpsAnomalyReport({
      fileName: "affected.gpx",
      activityIndex: 1,
      report,
    })

    expect(capture.groups[0]).toEqual([
      "[gps-anomaly] affected.gpx / activity 2: cleaned",
    ])
    expect(capture.groups).toHaveLength(report.examples.length + 1)
    expect(capture.groupEnds).toBe(capture.groups.length)
    expect(capture.debug.map(([label]) => label)).toEqual([
      "input",
      "configuration",
      "evidence",
      "decision",
      "output",
      "statistics",
      "performance",
    ])

    const logged = JSON.stringify(capture.debug)
    expect(logged).not.toContain("coordinates")
    expect(logged).not.toContain('"lng"')
    expect(logged).not.toContain('"lat"')
    expect(logged).not.toContain('"rawPoints"')
    expect(report.beforeStats.distanceKm).toBeGreaterThan(
      report.afterStats!.distanceKm
    )
    expect(report.work.boundedLookaheadCount).toBeGreaterThan(0)
    expect(maxPlausibleSpeed("cycling")).toBe(50)
  })

  test("reports ambiguous and rejected statuses with one outer group", () => {
    for (const [status, sourcePaths, result] of [
      (() => {
        const paths = [
          source(
            [0, 10, 10.0001, 10.0002, 10.0003, 10.0004].map((lng, index) =>
              point(index, lng, index * 1_000)
            )
          ),
        ]
        return ["ambiguous", paths, detectGpsAnomalies(paths)] as const
      })(),
      (() => {
        const paths = [source([point(0, 0, 0)])]
        return ["rejected", paths, detectGpsAnomalies(paths)] as const
      })(),
    ] as const) {
      const capture = captureConsole()
      logGpsAnomalyReport({
        fileName: `${status}.gpx`,
        activityIndex: 0,
        report: reportFor(result, sourcePaths),
      })
      expect(capture.groups[0]?.[0]).toBe(
        `[gps-anomaly] ${status}.gpx / activity 1: ${status}`
      )
      expect(capture.groupEnds).toBe(capture.groups.length)
      expect(capture.debug.map(([label]) => label)).toContain("performance")
    }
  })

  test("does not count structural short-path drops as omitted removals", () => {
    const capture = captureConsole()
    const sourcePaths = [
      source(
        [0, 0.0001, 0.0002, 0.0003, 0.0004, 10, 0.0005, 0.0006, 0.0007].map(
          (lng, index) => point(index, lng, index * 1_000)
        )
      ),
      source([point(0, 20, 0)]),
    ]
    const result = detectGpsAnomalies(sourcePaths, {
      activityType: "cycling",
    })
    const report = reportFor(result, sourcePaths)

    logGpsAnomalyReport({
      fileName: "short-path.gpx",
      activityIndex: 0,
      report,
    })

    const output = capture.debug.find(([label]) => label === "output")?.[1] as
      | { omittedExampleCount?: number }
      | undefined
    expect(output?.omittedExampleCount).toBe(0)
  })
})
