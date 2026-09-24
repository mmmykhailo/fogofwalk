import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import type { FogWorkerActivity } from "~/types/activities"
import { FOG_PROTOCOL_VERSION, type FogRequest } from "../protocol"
import { createFogEngine } from "."
import { bufferFogActivity } from "./buffer"
import { validateFogRenderData } from "./validate"

const overlappingFillCoordinates = {
  first: [
    [14.000236923331627, 50.002461053277834],
    [13.999885548084043, 50.00128527134704],
  ] as [number, number][],
  second: [
    [14.001899999203859, 49.99982727904059],
    [14.00195723735355, 50.00086659489153],
  ] as [number, number][],
}

function activity(id: string): FogWorkerActivity {
  return {
    id,
    name: id,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
  }
}

function rejectedActivity(id: string): FogWorkerActivity {
  return { id, name: id, coordinates: [] }
}

function request(overrides: Partial<FogRequest> = {}): FogRequest {
  return {
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: "request-1",
    generation: 1,
    libraryRevision: 1,
    coverageRevision: 1,
    mode: "corridor",
    kind: "rebuild",
    activities: [activity("one")],
    ...overrides,
  }
}

describe("FogEngine", () => {
  test("buffers cleaned paths independently without inventing a corridor bridge", () => {
    const result = bufferFogActivity({
      id: "disconnected",
      name: "disconnected",
      coordinates: [
        [14, 50],
        [14.001, 50],
        [15, 50],
        [15.001, 50],
      ],
      paths: [
        [
          [14, 50],
          [14.001, 50],
        ],
        [
          [15, 50],
          [15.001, 50],
        ],
      ],
    })

    expect(result.rejected).toBe(false)
    expect(result.inputPointCount).toBe(4)
    expect(result.masks).toHaveLength(2)
  })

  test("[F-042] keeps a valid overlapping fill rebuild complete", async () => {
    const result = await createFogEngine().process(
      request({
        requestId: "overlapping-fill",
        generation: 1,
        libraryRevision: 2,
        coverageRevision: 2,
        mode: "fill",
        kind: "rebuild",
        activities: [
          {
            id: "overlapping-first",
            name: "overlapping-first",
            coordinates: overlappingFillCoordinates.first,
          },
          {
            id: "overlapping-second",
            name: "overlapping-second",
            coordinates: overlappingFillCoordinates.second,
          },
        ],
      })
    )

    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    const { snapshot } = result
    expect(snapshot.completeness).toBe("complete")
    expect(snapshot.mode).toBe("fill")
    expect(snapshot.geometry.features).toHaveLength(1)
    expect(snapshot.geometry.features[0]?.geometry.type).toBe("Polygon")
    expect(snapshot.diagnostics).toMatchObject({
      degraded: false,
      warningCounts: {},
      coverageReducedCounts: {},
      errors: [],
      errorCounts: {},
      coverageReducedActivityCount: 0,
      rejectedActivityCount: 0,
      geometryFallbackCount: 0,
      processed: 2,
      total: 2,
      inputPoints: 4,
      outputPoints: 4,
    })
    expect(validateFogRenderData(snapshot.geometry).ok).toBe(true)
  })

  test("rebuilds the public large-track fixture in both modes", async () => {
    const xml = await readFile(
      new URL("../../../../public/sample-run.gpx", import.meta.url),
      "utf8"
    )
    const coordinates: [number, number][] = []
    for (const match of xml.matchAll(/<trkpt\b([^>]*)>/g)) {
      const attributes = match[1] ?? ""
      const latitude = Number(attributes.match(/\blat="([^"]+)"/)?.[1])
      const longitude = Number(attributes.match(/\blon="([^"]+)"/)?.[1])
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        coordinates.push([longitude, latitude])
      }
    }
    expect(coordinates).toHaveLength(82_364)

    for (const [generation, mode] of [
      [1, "corridor"],
      [2, "fill"],
    ] as const) {
      const result = await createFogEngine().process(
        request({
          generation,
          mode,
          activities: [
            {
              id: "public-sample-run",
              name: "public sample run",
              coordinates,
            },
          ],
        })
      )

      expect(result.status).toBe("complete")
      if (result.status !== "complete") continue
      expect(result.snapshot.completeness).toBe("complete")
      expect(result.snapshot.geometry.features.length).toBeGreaterThan(0)
      expect(result.snapshot.diagnostics).toMatchObject({
        inputPoints: 82_364,
        outputPoints: 298,
        warningCounts: { coalesced_duplicate_point: 3_061 },
        infoCounts: { coalesced_duplicate_point: 3_061 },
        coverageReducedCounts: {},
        coverageReducedActivityCount: 0,
        geometryFallbackCount: 0,
      })
    }
  })

  test("publishes request-relative progress and a complete revisioned snapshot", async () => {
    const progress: number[] = []
    const updates: number[] = []
    const engine = createFogEngine({
      hooks: {
        onProgress: (event) => progress.push(event.processed),
        onUpdate: (snapshot) => updates.push(snapshot.libraryRevision),
      },
      snapshotEvery: 1,
    })

    const result = await engine.process(request())

    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    expect(result.snapshot.libraryRevision).toBe(1)
    expect(result.snapshot.generation).toBe(1)
    expect(result.snapshot.completeness).toBe("complete")
    expect(progress).toEqual([1, 1, 1, 1])
    expect(updates).toEqual([1, 1])
  })

  test("keeps high-frequency duplicate cleanup informational and bounded", async () => {
    const duplicateCount = 3_061
    const result = await createFogEngine().process(
      request({
        activities: [
          {
            id: "dense",
            name: "dense",
            coordinates: [
              [14, 50],
              ...Array.from(
                { length: duplicateCount },
                () => [14, 50] as [number, number]
              ),
              [14.01, 50],
            ],
          },
        ],
      })
    )

    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    expect(result.snapshot.diagnostics).toMatchObject({
      degraded: false,
      warningCounts: { coalesced_duplicate_point: duplicateCount },
      infoCounts: { coalesced_duplicate_point: duplicateCount },
      coverageReducedCounts: {},
      normalizedActivityCount: 1,
      coverageReducedActivityCount: 0,
      repairedActivityCount: 0,
    })
    expect(result.snapshot.diagnostics.warnings.length).toBeLessThanOrEqual(8)
  })

  test("keeps a valid subset when input normalization reduces coverage", async () => {
    const result = await createFogEngine().process(
      request({
        activities: [
          {
            id: "partially-valid",
            name: "partially-valid",
            coordinates: [
              [14, 50],
              [Number.NaN, 50],
              [14.01, 50],
              [14.02, 50],
            ],
          },
          activity("good"),
        ],
      })
    )

    expect(result.status).toBe("partial")
    if (result.status !== "partial") return
    expect(result.snapshot.diagnostics).toMatchObject({
      coverageReducedActivityCount: 1,
      warningCounts: { dropped_invalid_point: 1 },
    })
    expect(result.snapshot.diagnostics.featureCount).toBeGreaterThan(0)
    expect(result.snapshot.completeness).toBe("partial")
  })

  test("rejects an append whose base revision or mode does not match", async () => {
    const engine = createFogEngine()
    await engine.process(request())

    const staleRevision = await engine.process(
      request({
        requestId: "stale",
        kind: "append",
        libraryRevision: 2,
        baseLibraryRevision: 0,
        baseCoverageRevision: 0,
      })
    )
    expect(staleRevision.status).toBe("rejected")

    const staleMode = await engine.process(
      request({
        requestId: "mode",
        kind: "append",
        libraryRevision: 2,
        baseLibraryRevision: 1,
        baseCoverageRevision: 1,
        mode: "fill",
      })
    )
    expect(staleMode.status).toBe("rejected")
  })

  test("cancellation at a scheduler checkpoint produces no snapshot", async () => {
    let release: (() => void) | undefined
    const engine = createFogEngine({
      hooks: {
        yieldToScheduler: () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      },
    })
    const pending = engine.process(request())
    engine.cancel(1)
    release?.()

    expect(await pending).toEqual({ status: "cancelled", snapshot: null })
  })

  test("[F-040] keeps rejected activities in cumulative partial state", async () => {
    const engine = createFogEngine()
    const rebuilt = await engine.process(
      request({ activities: [activity("one"), rejectedActivity("bad")] })
    )

    expect(rebuilt.status).toBe("partial")
    if (rebuilt.status !== "partial") return
    expect(rebuilt.snapshot.completeness).toBe("partial")
    expect(rebuilt.snapshot.diagnostics).toMatchObject({
      processed: 2,
      total: 2,
      rejectedActivityCount: 1,
    })

    const append = await engine.process(
      request({
        requestId: "append-after-partial",
        kind: "append",
        libraryRevision: 2,
        baseLibraryRevision: 1,
        baseCoverageRevision: 1,
        activities: [activity("two")],
      })
    )
    expect(append.status).toBe("rejected")
    if (append.status === "rejected") {
      expect(append.message).toContain("current base is partial")
    }
  })

  test("publishes intermediate updates by time when no item cadence is set", async () => {
    let clock = 0
    const updates: number[] = []
    const engine = createFogEngine({
      now: () => clock,
      emitIntervalMs: 50,
      hooks: {
        onUpdate: (snapshot) => updates.push(snapshot.diagnostics.processed),
        yieldToScheduler: async () => {
          clock += 60
        },
      },
    })

    await engine.process(
      request({ activities: [activity("one"), activity("two")] })
    )
    expect(updates).toEqual([1, 2, 2])
  })
})
