import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~shared/activities"
import { createActivityImportService } from "./service"
import type { ImportProgressEvent, ImportStage } from "./service"
import { createMemoryActivityLibraryRepository } from "../repository"
import type { LibraryCommit } from "../libraryEvents"
import type { GpsAnomalyReport } from "~/lib/parsers/types"

function activity(id: string, hash = `hash-${id}`): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: null,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    paths: [
      [
        [14, 50],
        [14.01, 50.01],
      ],
    ],
    format: "gpx",
    contentHash: hash,
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

function file(name: string): File {
  return new File([name], name, { type: "application/gpx+xml" })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function waitFor(
  predicate: () => boolean,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

function libraryCommit(
  operationId: string,
  activities: ParsedActivity[]
): LibraryCommit {
  return {
    snapshot: {
      revision: 1,
      coverageRevision: 1,
      activities,
    },
    change: {
      operationId,
      fromRevision: 0,
      revision: 1,
      added: activities,
      updated: [],
      removed: [],
      duplicates: [],
      domains: {
        membership: true,
        geometry: true,
        metadata: true,
        statistics: true,
      },
    },
  }
}

function latestStages(events: ImportProgressEvent[]): Map<number, ImportStage> {
  return new Map(events.map((event) => [event.fileIndex, event.stage] as const))
}

const anomalyReport: GpsAnomalyReport = {
  status: "cleaned",
  counts: {
    inputPoints: 9,
    retainedPoints: 8,
    removedPoints: 1,
    splitCount: 1,
    trimmedPrefixPoints: 0,
    trimmedSuffixPoints: 0,
    reasons: { teleport_spike: 1 },
  },
  examples: [],
  work: {
    distanceCalculations: 10,
    pointsVisited: 9,
    boundedLookaheadCount: 2,
  },
  format: "gpx",
  activityType: "walking",
  sourcePathCount: 1,
  timestampPointCount: 9,
  nonPositiveTimestampCount: 0,
  emittedPathCount: 2,
  beforeStats: {
    distanceKm: activity("before").stats.distanceKm,
    durationMs: activity("before").stats.durationMs,
    movingTimeMs: activity("before").stats.movingTimeMs,
  },
  afterStats: activity("after").stats,
  detectorDurationMs: 1,
}

describe("ActivityImportService", () => {
  test("bounds parser concurrency and reports each file terminally", async () => {
    let active = 0
    let peak = 0
    const repository = createMemoryActivityLibraryRepository()
    const service = createActivityImportService({
      concurrency: 2,
      parseFile: async (input) => {
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        active--
        return [activity(input.name)]
      },
      commit: (operationId, activities) =>
        repository.commit({ type: "import", operationId, activities }, 0),
    })

    const result = await service.importFiles([
      file("a.gpx"),
      file("b.gpx"),
      file("c.gpx"),
    ])

    expect(peak).toBeLessThanOrEqual(2)
    expect(result.files).toHaveLength(3)
    expect(result.files.every((outcome) => outcome.stage === "complete")).toBe(
      true
    )
    expect(
      result.files.every((outcome) =>
        ["committed", "duplicate"].includes(outcome.status)
      )
    ).toBe(true)
  })

  test("[I-038] keeps concurrent preparation rows and commits by file order", async () => {
    const files = [file("a.gpx"), file("b.gpx"), file("c.gpx")]
    const parsers = new Map(
      files.map((input) => [input.name, deferred<ParsedActivity[]>()])
    )
    const commitDeferred = deferred<LibraryCommit>()
    const events: ImportProgressEvent[] = []
    let committedActivities: ParsedActivity[] = []
    const service = createActivityImportService({
      concurrency: 2,
      parseFile: (input) => parsers.get(input.name)!.promise,
      commit: async (_operationId, activities) => {
        committedActivities = activities
        return commitDeferred.promise
      },
      onProgress: (event) => events.push(event),
    })

    const importPromise = service.importFiles(files, "concurrent")
    await waitFor(
      () =>
        new Set(
          events
            .filter((event) => event.stage === "parsing")
            .map((event) => event.fileIndex)
        ).size === 2,
      "the first two parser workers did not start"
    )

    parsers.get("a.gpx")!.resolve([activity("a")])
    await waitFor(
      () =>
        events.some(
          (event) => event.fileIndex === 0 && event.stage === "ready"
        ),
      "file 0 did not finish preparation"
    )
    await waitFor(
      () =>
        events.some(
          (event) => event.fileIndex === 2 && event.stage === "parsing"
        ),
      "the freed parser worker did not claim file 2"
    )

    const firstReady = events.find(
      (event) => event.fileIndex === 0 && event.stage === "ready"
    )
    expect(firstReady?.completedFiles).toBe(1)
    expect(
      events.some(
        (event) => event.fileIndex === 0 && event.stage === "complete"
      )
    ).toBe(false)
    expect(latestStages(events)).toEqual(
      new Map([
        [0, "ready"],
        [1, "parsing"],
        [2, "parsing"],
      ])
    )

    parsers.get("b.gpx")!.resolve([activity("b")])
    await waitFor(
      () =>
        events.some(
          (event) => event.fileIndex === 1 && event.stage === "ready"
        ),
      "file 1 did not finish preparation"
    )
    expect(
      events.find((event) => event.fileIndex === 1 && event.stage === "ready")
        ?.completedFiles
    ).toBe(2)

    parsers.get("c.gpx")!.resolve([activity("c")])
    await waitFor(
      () =>
        events.some(
          (event) => event.fileIndex === 2 && event.stage === "ready"
        ),
      "file 2 did not finish preparation"
    )
    expect(
      events.find((event) => event.fileIndex === 2 && event.stage === "ready")
        ?.completedFiles
    ).toBe(3)

    await waitFor(
      () => committedActivities.length === 3,
      "the ordered batch commit was not invoked"
    )
    expect(committedActivities.map(({ id }) => id)).toEqual(["a", "b", "c"])
    expect(
      events
        .filter((event) => event.stage === "committing")
        .every((event) => event.completedFiles === 3)
    ).toBe(true)
    expect(events.some((event) => event.stage === "committed")).toBe(false)
    expect(events.some((event) => event.stage === "complete")).toBe(false)

    commitDeferred.resolve(libraryCommit("concurrent", committedActivities))
    const result = await importPromise

    expect(result.files.every((outcome) => outcome.stage === "complete")).toBe(
      true
    )
    for (const index of [0, 1, 2]) {
      expect(
        events
          .filter((event) => event.fileIndex === index)
          .map((event) => event.stage)
      ).toEqual([
        "reading",
        "parsing",
        "validating",
        "ready",
        "committing",
        "committed",
        "deriving",
        "complete",
      ])
    }
  })

  for (const scenario of [
    {
      label: "rejected",
      parseBad: async () => [],
      expected: { status: "rejected", errorCode: "empty-file" },
    },
    {
      label: "failed",
      parseBad: async () => {
        throw new Error("malformed")
      },
      expected: { status: "failed", error: "malformed" },
    },
  ] as const) {
    test(`does not keep a ${scenario.label} sibling active`, async () => {
      const validParser = deferred<ParsedActivity[]>()
      const events: ImportProgressEvent[] = []
      let committedActivities: ParsedActivity[] = []
      const service = createActivityImportService({
        concurrency: 2,
        parseFile: (input) =>
          input.name === "bad.gpx" ? scenario.parseBad() : validParser.promise,
        commit: async (operationId, activities) => {
          committedActivities = activities
          return libraryCommit(operationId, activities)
        },
        onProgress: (event) => events.push(event),
      })

      const importPromise = service.importFiles(
        [file("bad.gpx"), file("good.gpx")],
        `sibling-${scenario.label}`
      )
      await waitFor(
        () =>
          events.some(
            (event) => event.fileIndex === 0 && event.stage === "complete"
          ),
        `the ${scenario.label} file did not finish preparation`
      )

      const terminal = events.find(
        (event) => event.fileIndex === 0 && event.stage === "complete"
      )
      expect(terminal?.completedFiles).toBe(1)
      expect(
        events.some(
          (event) => event.fileIndex === 1 && event.stage === "parsing"
        )
      ).toBe(true)
      expect(
        events.some(
          (event) =>
            event.fileIndex === 0 &&
            ["ready", "committing", "committed", "deriving"].includes(
              event.stage
            )
        )
      ).toBe(false)

      validParser.resolve([activity("good")])
      const result = await importPromise

      expect(result.files[0]).toMatchObject({
        stage: "complete",
        ...scenario.expected,
      })
      expect(result.files[1]).toMatchObject({
        stage: "complete",
        status: "committed",
      })
      expect(committedActivities.map(({ id }) => id)).toEqual(["good"])
      expect(
        events.filter(
          (event) => event.fileIndex === 0 && event.stage === "complete"
        )
      ).toHaveLength(1)
    })
  }

  test("keeps a bad sibling from rejecting valid files", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const service = createActivityImportService({
      parseFile: async (input) => {
        if (input.name === "bad.gpx") throw new Error("malformed")
        return [activity(input.name)]
      },
      commit: (operationId, activities) =>
        repository.commit({ type: "import", operationId, activities }, 0),
    })

    const result = await service.importFiles([
      file("bad.gpx"),
      file("good.gpx"),
    ])

    expect(result.files[0]).toMatchObject({
      status: "failed",
      error: "malformed",
    })
    expect(result.files[1]?.status).toBe("committed")
    expect((await repository.load()).activities).toHaveLength(1)
  })

  test("keeps valid parser siblings and strips transient anomaly reports", async () => {
    const repository = createMemoryActivityLibraryRepository()
    const parsed = {
      ...activity("cleaned"),
      gpsAnomalyReport: anomalyReport,
    }
    const service = createActivityImportService({
      parseFile: async () => ({
        activities: [parsed],
        rejections: [
          {
            id: "ambiguous",
            reason: "ambiguous-gps-discontinuity",
            activityIndex: 1,
            gpsAnomalyReport: {
              ...anomalyReport,
              status: "ambiguous",
              afterStats: null,
            },
          },
        ],
      }),
      commit: (operationId, activities) =>
        repository.commit({ type: "import", operationId, activities }, 0),
    })

    const result = await service.importFiles([file("siblings.gpx")])

    expect(result.files[0]).toMatchObject({
      status: "committed",
      parsedActivityCount: 2,
    })
    expect(result.files[0]?.activities).toEqual(
      expect.arrayContaining([
        {
          id: "ambiguous",
          status: "rejected",
          reason: "ambiguous-gps-discontinuity",
        },
        {
          id: expect.any(String),
          contentHash: expect.any(String),
          status: "committed",
        },
      ])
    )
    const stored = await repository.load()
    expect(stored.activities).toHaveLength(1)
    expect(stored.activities[0]).not.toHaveProperty("gpsAnomalyReport")
  })

  test("pre-read cancellation increments preparation before completion", async () => {
    const controller = new AbortController()
    controller.abort()
    let parses = 0
    let commits = 0
    const events: ImportProgressEvent[] = []
    const service = createActivityImportService({
      parseFile: async () => {
        parses++
        return [activity("cancelled")]
      },
      commit: async () => {
        commits++
        return libraryCommit("pre-read-cancel", [])
      },
      signal: controller.signal,
      onProgress: (event) => events.push(event),
    })

    const result = await service.importFiles(
      [file("cancelled.gpx")],
      "pre-read-cancel"
    )

    expect(parses).toBe(0)
    expect(commits).toBe(0)
    expect(result.cancelled).toBe(true)
    expect(result.files[0]).toMatchObject({
      status: "cancelled",
      stage: "complete",
    })
    expect(events).toEqual([
      {
        operationId: "pre-read-cancel",
        fileIndex: 0,
        stage: "complete",
        completedFiles: 1,
        totalFiles: 1,
      },
    ])
  })

  test("cancellation after preparation closes ready files without committing", async () => {
    const controller = new AbortController()
    let commits = 0
    const events: ImportProgressEvent[] = []
    const service = createActivityImportService({
      parseFile: async () => [activity("cancelled")],
      commit: async () => {
        commits++
        return libraryCommit("ready-cancel", [])
      },
      signal: controller.signal,
      onProgress: (event) => {
        events.push(event)
        if (event.stage === "ready") controller.abort()
      },
    })

    const result = await service.importFiles(
      [file("cancelled.gpx")],
      "ready-cancel"
    )

    expect(commits).toBe(0)
    expect(result.cancelled).toBe(true)
    expect(result.files[0]).toMatchObject({
      status: "cancelled",
      stage: "complete",
    })
    expect(result.files[0]?.activities).toEqual([
      { id: "cancelled", contentHash: expect.any(String), status: "cancelled" },
    ])
    expect(events.map(({ stage }) => stage)).toEqual([
      "reading",
      "parsing",
      "validating",
      "ready",
      "complete",
    ])
  })

  test("returns an explicit empty result without invoking the committer", async () => {
    let commits = 0
    const service = createActivityImportService({
      commit: async () => {
        commits++
        throw new Error("must not commit")
      },
    })

    await expect(service.importFiles([])).resolves.toMatchObject({
      files: [],
      activities: [],
      cancelled: false,
    })
    expect(commits).toBe(0)
  })

  test("marks accepted files failed when the durable commit fails", async () => {
    const events: ImportProgressEvent[] = []
    const service = createActivityImportService({
      parseFile: async () => [activity("storage-failure")],
      commit: async () => {
        throw new Error("storage unavailable")
      },
      onProgress: (event) => events.push(event),
    })

    const result = await service.importFiles([file("storage-failure.gpx")])

    expect(result.files[0]).toMatchObject({
      status: "failed",
      stage: "complete",
      error: "storage unavailable",
    })
    expect(result.activities[0]).toMatchObject({ status: "failed" })
    expect(events.map(({ stage }) => stage)).toEqual([
      "reading",
      "parsing",
      "validating",
      "ready",
      "committing",
      "complete",
    ])
  })
})
