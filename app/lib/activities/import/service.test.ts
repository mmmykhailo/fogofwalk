import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~shared/activities"
import { createActivityImportService } from "./service"
import { MemoryActivityLibraryRepository } from "../repository"

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

describe("ActivityImportService", () => {
  test("bounds parser concurrency and reports each file terminally", async () => {
    let active = 0
    let peak = 0
    const repository = new MemoryActivityLibraryRepository()
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

  test("keeps a bad sibling from rejecting valid files", async () => {
    const repository = new MemoryActivityLibraryRepository()
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

  test("cancellation before commit never invokes the committer", async () => {
    const controller = new AbortController()
    let commits = 0
    const service = createActivityImportService({
      parseFile: async () => {
        controller.abort()
        return [activity("cancelled")]
      },
      commit: async () => {
        commits++
        throw new Error("must not commit")
      },
      signal: controller.signal,
    })

    const result = await service.importFiles([file("cancelled.gpx")])

    expect(commits).toBe(0)
    expect(result.cancelled).toBe(true)
    expect(result.files[0]?.status).toBe("cancelled")
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
    const service = createActivityImportService({
      parseFile: async () => [activity("storage-failure")],
      commit: async () => {
        throw new Error("storage unavailable")
      },
    })

    const result = await service.importFiles([file("storage-failure.gpx")])

    expect(result.files[0]).toMatchObject({
      status: "failed",
      error: "storage unavailable",
    })
    expect(result.activities[0]).toMatchObject({ status: "failed" })
  })
})
