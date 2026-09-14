import { afterEach, describe, expect, test } from "bun:test"
import {
  fogCoordinator,
  getFogStatus,
  mapStore,
  postToFogWorker,
  queueAddedActivitiesForFog,
  recordFogSnapshot,
  rebuildFogProjection,
  startFogRun,
  worldFogGeoJSON,
} from "./mapStore"
import { isFogCacheValid, type FogCache } from "./storage"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogDiagnostics,
  type FogReply,
  type FogRequest,
  type FogSnapshot,
} from "~/lib/fog/protocol"
import type { ParsedActivity } from "~/types/activities"

const originalWorker = mapStore.worker
const originalRunId = mapStore.runId
const originalFogSnapshot = mapStore.fogSnapshot
const originalFogData = mapStore.fogData
const originalFogMode = mapStore.fogMode
const originalRenderSourceRevision = mapStore.renderSourceRevision
const originalActivities = mapStore.activities
const originalLibraryRevision = mapStore.libraryRevision
const originalCoverageRevision = mapStore.coverageRevision
const originalUniqueDistanceProjectionRevision =
  mapStore.uniqueDistanceProjectionRevision

afterEach(() => {
  // The production map store owns one coordinator for the lifetime of the
  // module. Clear it between tests so an active/queued request from one test
  // cannot be mistaken for the worker state of the next test.
  mapStore.worker = { postMessage() {} } as unknown as Worker
  postToFogWorker({ type: "RESET" })
  mapStore.worker = originalWorker
  mapStore.runId = originalRunId
  mapStore.fogSnapshot = originalFogSnapshot
  mapStore.fogData = originalFogData
  mapStore.fogMode = originalFogMode
  mapStore.renderSourceRevision = originalRenderSourceRevision
  mapStore.activities = originalActivities
  mapStore.libraryRevision = originalLibraryRevision
  mapStore.coverageRevision = originalCoverageRevision
  mapStore.uniqueDistanceProjectionRevision =
    originalUniqueDistanceProjectionRevision
})

function expectFogRequest(
  message: unknown,
  expected: Record<string, unknown>
): void {
  expect(message).toMatchObject({
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: expect.any(String),
    generation: expect.any(Number),
    libraryRevision: expect.any(Number),
    activities: expect.any(Array),
    ...expected,
  })
}

function activity(id: string): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: null,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
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

function snapshotForRequest(
  request: FogRequest,
  diagnostics: Partial<FogDiagnostics> = {},
  completeness: FogSnapshot["completeness"] = "complete"
): FogSnapshot {
  return {
    generation: request.generation,
    libraryRevision: request.libraryRevision,
    coverageRevision: request.coverageRevision,
    mode: request.mode,
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    completeness,
    geometry: worldFogGeoJSON(),
    diagnostics: {
      processed: request.activities.length,
      total: request.activities.length,
      inputPoints: 0,
      outputPoints: 0,
      featureCount: 0,
      vertexCount: 0,
      warnings: [],
      errors: [],
      degraded: false,
      ...diagnostics,
    },
  }
}

describe("fog worker run state", () => {
  test("keeps informational normalization quiet but exposes coverage loss", () => {
    mapStore.worker = { postMessage() {} } as unknown as Worker
    mapStore.activities = []
    mapStore.fogMode = "corridor"
    const generation = startFogRun()
    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [],
      mode: "corridor",
    })

    recordFogSnapshot({
      generation,
      libraryRevision: mapStore.libraryRevision,
      coverageRevision: mapStore.coverageRevision,
      mode: "corridor",
      algorithmVersion: FOG_ALGORITHM_VERSION as typeof FOG_ALGORITHM_VERSION,
      partitionSchemeVersion:
        FOG_PARTITION_SCHEME_VERSION as typeof FOG_PARTITION_SCHEME_VERSION,
      completeness: "complete",
      geometry: worldFogGeoJSON(),
      diagnostics: {
        processed: 0,
        total: 0,
        inputPoints: 0,
        outputPoints: 0,
        featureCount: 0,
        vertexCount: 0,
        warnings: [],
        errors: [],
        degraded: false,
        warningCounts: { coalesced_duplicate_point: 3_061 },
        infoCounts: { coalesced_duplicate_point: 3_061 },
        coverageReducedCounts: {},
        normalizedActivityCount: 1,
        coverageReducedActivityCount: 0,
        repairedActivityCount: 0,
        rejectedActivityCount: 0,
        geometryFallbackCount: 0,
      },
    })
    expect(getFogStatus()).toMatchObject({
      phase: "idle",
      normalizedActivityCount: 1,
      coverageReducedActivityCount: 0,
    })

    recordFogSnapshot({
      generation,
      libraryRevision: mapStore.libraryRevision,
      coverageRevision: mapStore.coverageRevision,
      mode: "corridor",
      algorithmVersion: FOG_ALGORITHM_VERSION,
      partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
      completeness: "partial",
      geometry: worldFogGeoJSON(),
      diagnostics: {
        processed: 0,
        total: 0,
        inputPoints: 0,
        outputPoints: 0,
        featureCount: 0,
        vertexCount: 0,
        warnings: [],
        errors: [],
        degraded: true,
        warningCounts: { dropped_invalid_point: 1 },
        infoCounts: {},
        coverageReducedCounts: { dropped_invalid_point: 1 },
        normalizedActivityCount: 0,
        coverageReducedActivityCount: 1,
        repairedActivityCount: 1,
        rejectedActivityCount: 0,
        geometryFallbackCount: 0,
      },
    })
    expect(getFogStatus()).toMatchObject({
      phase: "degraded",
      coverageReducedActivityCount: 1,
    })
  })

  test("coalesces overlapping batches in the coordinator", () => {
    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.runId = 7
    mapStore.libraryRevision = 0
    mapStore.activities = []

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [],
      mode: "corridor",
    })
    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [],
      mode: "corridor",
    })

    expect(messages).toHaveLength(1)
    expect(fogCoordinator.activeRequest).not.toBeNull()
    expect(fogCoordinator.queuedSnapshot).not.toBeNull()
    expectFogRequest(messages[0], {
      generation: 7,
      kind: "rebuild",
      mode: "corridor",
    })
  })

  test("reset abandons all outstanding batches", () => {
    mapStore.worker = { postMessage() {} } as unknown as Worker
    mapStore.runId = 3
    mapStore.libraryRevision = 1
    mapStore.activities = [activity("old")]

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "fill",
      libraryRevision: 1,
    })
    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "corridor",
      libraryRevision: 2,
    })

    postToFogWorker({ type: "RESET" })

    expect(fogCoordinator.activeRequest).toBeNull()
    expect(fogCoordinator.queuedSnapshot).toBeNull()
    expect(fogCoordinator.completedSnapshot).toBeNull()
  })

  test("does not schedule work when the worker is unavailable", () => {
    mapStore.worker = null

    expect(
      postToFogWorker({
        type: "PROCESS_ACTIVITIES",
        activities: [activity("missing-worker")],
        mode: "corridor",
      })
    ).toBe(false)
    expect(fogCoordinator.activeRequest).toBeNull()
    expect(fogCoordinator.queuedSnapshot).toBeNull()
  })

  test("starts a fill rebuild with a fresh zeroed status after a completed run", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.runId = 20
    mapStore.libraryRevision = 8
    mapStore.coverageRevision = 3
    mapStore.fogMode = "corridor"

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 8,
      coverageRevision: 3,
    })
    const initialRequest = messages[0] as {
      requestId: string
      generation: number
    }
    const completedSnapshot = {
      generation: initialRequest.generation,
      libraryRevision: 8,
      coverageRevision: 3,
      mode: "corridor" as const,
      algorithmVersion: FOG_ALGORITHM_VERSION as typeof FOG_ALGORITHM_VERSION,
      partitionSchemeVersion:
        FOG_PARTITION_SCHEME_VERSION as typeof FOG_PARTITION_SCHEME_VERSION,
      completeness: "complete" as const,
      geometry: worldFogGeoJSON(),
      diagnostics: {
        processed: 2,
        total: 2,
        inputPoints: 4,
        outputPoints: 0,
        featureCount: 0,
        vertexCount: 0,
        warnings: [],
        errors: [],
        degraded: false,
      },
    }
    fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: initialRequest.requestId,
      generation: initialRequest.generation,
      snapshot: completedSnapshot,
    })
    recordFogSnapshot(completedSnapshot)
    expect(getFogStatus()).toMatchObject({
      phase: "idle",
      processed: 2,
      total: 2,
      mode: "corridor",
    })

    const previousGeneration = mapStore.runId
    expect(rebuildFogProjection("fill")).toBe(true)

    expect(getFogStatus()).toMatchObject({
      phase: "processing",
      generation: previousGeneration + 1,
      mode: "fill",
      processed: 0,
      total: 2,
    })
    expect(messages[1]).toMatchObject({
      kind: "cancel",
      generation: previousGeneration + 1,
    })
    expect(messages[2]).toMatchObject({
      kind: "rebuild",
      generation: previousGeneration + 1,
      mode: "fill",
      activities: [
        { id: first.id, name: first.name, coordinates: first.coordinates },
        { id: second.id, name: second.name, coordinates: second.coordinates },
      ],
    })
  })

  test("exposes an unavailable-worker failure and a retryable rebuild", () => {
    mapStore.activities = [activity("retry")]
    mapStore.libraryRevision = 3
    mapStore.fogMode = "corridor"
    mapStore.worker = null

    expect(rebuildFogProjection()).toBe(false)
    expect(getFogStatus()).toMatchObject({
      phase: "failed",
      libraryRevision: 3,
    })

    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    expect(rebuildFogProjection()).toBe(true)
    expect(getFogStatus()).toMatchObject({ phase: "processing", total: 1 })
    expect(messages).toHaveLength(2)
    expectFogRequest(messages[1], {
      kind: "rebuild",
      libraryRevision: 3,
      activities: [{ id: "retry" }],
    })
  })

  test("replays the library before adding to a cache-cold worker", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.runId = 10
    mapStore.libraryRevision = 1

    queueAddedActivitiesForFog([second], "corridor")

    expectFogRequest(messages[0], {
      generation: 10,
      kind: "rebuild",
      mode: "corridor",
      activities: [
        {
          id: first.id,
          name: first.name,
          coordinates: first.coordinates,
        },
        {
          id: second.id,
          name: second.name,
          coordinates: second.coordinates,
        },
      ],
    })
  })

  test("uses a completed coordinator base for incremental additions", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first]
    mapStore.runId = 4
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [first],
      mode: "fill",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })
    const initialRequest = messages[0] as {
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
    }
    fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: initialRequest.requestId,
      generation: initialRequest.generation,
      snapshot: {
        generation: 4,
        libraryRevision: 1,
        coverageRevision: 1,
        mode: "fill",
        algorithmVersion: FOG_ALGORITHM_VERSION,
        partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
        completeness: "complete",
        geometry: worldFogGeoJSON(),
        diagnostics: {
          processed: 1,
          total: 1,
          inputPoints: 2,
          outputPoints: 0,
          featureCount: 0,
          vertexCount: 0,
          warnings: [],
          errors: [],
          degraded: false,
        },
      },
    })
    mapStore.activities = [first, second]
    mapStore.libraryRevision = 2
    mapStore.coverageRevision = 2

    queueAddedActivitiesForFog([second], "fill")

    expectFogRequest(messages[1], {
      generation: 4,
      kind: "append",
      mode: "fill",
      baseLibraryRevision: 1,
      activities: [
        { id: second.id, name: second.name, coordinates: second.coordinates },
      ],
    })
  })

  test("keeps append progress request-local when snapshots are cumulative", () => {
    const messages: unknown[] = []
    const base = activity("base")
    const added = Array.from({ length: 209 }, (_, index) =>
      activity(`added-${index}`)
    )
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [base]
    mapStore.runId = 30
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1
    mapStore.fogMode = "corridor"

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [base],
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })
    const baseRequest = messages[0] as FogRequest
    const baseSnapshot = snapshotForRequest(baseRequest)
    fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: baseRequest.requestId,
      generation: baseRequest.generation,
      snapshot: baseSnapshot,
    })
    recordFogSnapshot(baseSnapshot)

    mapStore.activities = [base, ...added]
    mapStore.libraryRevision = 2
    mapStore.coverageRevision = 2
    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: added,
      mode: "corridor",
      kind: "append",
      libraryRevision: 2,
      coverageRevision: 2,
    })

    const appendRequest = messages[1] as FogRequest
    expect(appendRequest.kind).toBe("append")
    expect(appendRequest.activities).toHaveLength(209)
    expect(getFogStatus()).toMatchObject({
      requestId: appendRequest.requestId,
      processed: 0,
      total: 209,
    })

    const progressReply = {
      type: "PROGRESS" as const,
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: appendRequest.requestId,
      generation: appendRequest.generation,
      libraryRevision: appendRequest.libraryRevision,
      coverageRevision: appendRequest.coverageRevision,
      mode: appendRequest.mode,
      processed: 100,
      total: 209,
      stage: "buffering" as const,
    } satisfies Extract<FogReply, { type: "PROGRESS" }>
    expect(fogCoordinator.handleReply(progressReply).accepted).toBe(true)
    expect(getFogStatus()).toMatchObject({ processed: 100, total: 209 })

    const interimSnapshot = snapshotForRequest(appendRequest, {
      processed: 101,
      total: 210,
    })
    recordFogSnapshot(interimSnapshot, false)
    expect(getFogStatus()).toMatchObject({ processed: 100, total: 209 })

    expect(
      fogCoordinator.handleReply({ ...progressReply, processed: 90 }).accepted
    ).toBe(true)
    expect(getFogStatus()).toMatchObject({ processed: 100, total: 209 })

    expect(
      fogCoordinator.handleReply({ ...progressReply, processed: 150 }).accepted
    ).toBe(true)
    expect(getFogStatus()).toMatchObject({ processed: 150, total: 209 })

    const finalSnapshot = snapshotForRequest(appendRequest, {
      processed: 210,
      total: 210,
    })
    const terminal = fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: appendRequest.requestId,
      generation: appendRequest.generation,
      snapshot: finalSnapshot,
    })
    expect(terminal).toMatchObject({ accepted: true, terminal: true })
    recordFogSnapshot(finalSnapshot)
    expect(getFogStatus()).toMatchObject({
      requestId: appendRequest.requestId,
      processed: 209,
      total: 209,
      phase: "idle",
    })
  })

  test("finishes partial requests at their request length while keeping degraded state", () => {
    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [activity("partial")]
    mapStore.runId = 31
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1
    mapStore.fogMode = "corridor"

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })
    const request = messages[0] as FogRequest
    const snapshot = snapshotForRequest(
      request,
      { degraded: true, errors: ["reduced coverage"] },
      "partial"
    )

    fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      snapshot,
    })

    expect(getFogStatus()).toMatchObject({
      phase: "degraded",
      requestId: request.requestId,
      processed: 1,
      total: 1,
    })
  })

  test("preserves incomplete progress for a failed request", () => {
    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [activity("failed"), activity("pending")]
    mapStore.runId = 32
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1
    mapStore.fogMode = "corridor"

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })
    const request = messages[0] as FogRequest
    fogCoordinator.handleReply({
      type: "PROGRESS",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      libraryRevision: request.libraryRevision,
      coverageRevision: request.coverageRevision,
      mode: request.mode,
      processed: 1,
      total: 2,
      stage: "buffering",
    })
    fogCoordinator.handleReply({
      type: "DONE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      snapshot: null,
    })

    expect(getFogStatus()).toMatchObject({
      phase: "failed",
      requestId: request.requestId,
      processed: 1,
      total: 2,
    })
  })

  test("cancellation never publishes a completed request count", () => {
    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [activity("cancelled"), activity("pending")]
    mapStore.runId = 33
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1
    mapStore.fogMode = "corridor"

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: mapStore.activities,
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })
    const request = messages[0] as FogRequest
    fogCoordinator.handleReply({
      type: "PROGRESS",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      libraryRevision: request.libraryRevision,
      coverageRevision: request.coverageRevision,
      mode: request.mode,
      processed: 1,
      total: 2,
      stage: "buffering",
    })
    const cancellation = fogCoordinator.cancel()!
    fogCoordinator.handleReply({
      type: "CANCELLED",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: cancellation.request.requestId,
      generation: cancellation.request.generation,
      libraryRevision: cancellation.request.libraryRevision,
      coverageRevision: cancellation.request.coverageRevision,
      mode: cancellation.request.mode,
    })

    expect(getFogStatus()).toMatchObject({
      phase: "idle",
      requestId: null,
      processed: 0,
      total: 0,
    })
  })

  test("keeps additions behind an active rebuild without duplicate sends", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.libraryRevision = 1
    mapStore.coverageRevision = 1

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [first, second],
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
      coverageRevision: 1,
    })

    queueAddedActivitiesForFog([second], "corridor")

    expect(messages).toHaveLength(1)
    expect(fogCoordinator.activeRequest?.request.kind).toBe("rebuild")
    expect(fogCoordinator.queuedSnapshot).toMatchObject({
      generation: mapStore.runId,
      libraryRevision: mapStore.libraryRevision,
      mode: "corridor",
    })
  })
})

describe("fog cache validity", () => {
  const cache: FogCache = {
    activityIds: ["a", "b"],
    coverageRevision: 2,
    fogMode: "corridor",
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    completeness: "complete",
    fogData: worldFogGeoJSON(),
  }

  test("accepts the same activity set in any order", () => {
    expect(isFogCacheValid(cache, ["b", "a"], "corridor")).toBe(true)
  })

  test("[F-039] rejects partial or legacy cache completeness markers", () => {
    expect(
      isFogCacheValid(
        { ...cache, completeness: "partial" as never },
        ["a", "b"],
        "corridor"
      )
    ).toBe(false)
    expect(
      isFogCacheValid(
        { ...cache, completeness: undefined as never },
        ["a", "b"],
        "corridor"
      )
    ).toBe(false)
  })

  test("rejects missing, additional, or differently-modeled activities", () => {
    expect(isFogCacheValid(cache, ["a"], "corridor")).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b", "c"], "corridor")).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b"], "fill")).toBe(false)
  })

  test("rejects stale algorithm, partition, and library identities", () => {
    expect(
      isFogCacheValid(
        {
          ...cache,
          algorithmVersion: (FOG_ALGORITHM_VERSION -
            1) as typeof FOG_ALGORITHM_VERSION,
        },
        ["a", "b"],
        "corridor"
      )
    ).toBe(false)
    expect(
      isFogCacheValid(
        {
          ...cache,
          partitionSchemeVersion: (FOG_PARTITION_SCHEME_VERSION -
            1) as typeof FOG_PARTITION_SCHEME_VERSION,
        },
        ["a", "b"],
        "corridor"
      )
    ).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b"], "corridor", 3)).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b"], "corridor", 2)).toBe(true)
  })
})
