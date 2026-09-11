import { afterEach, describe, expect, test } from "bun:test"
import {
  fogCoordinator,
  getFogProcessedCount,
  getFogStatus,
  mapStore,
  postToFogWorker,
  queueAddedActivitiesForFog,
  rebuildFogProjection,
  setFogProcessedCount,
  subscribeFogProgress,
  worldFogGeoJSON,
} from "./mapStore"
import { isFogCacheValid, type FogCache } from "./storage"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
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
const originalUniqueDistanceProjectionRevision =
  mapStore.uniqueDistanceProjectionRevision
const originalProcessedCount = mapStore.processedCount

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
  mapStore.uniqueDistanceProjectionRevision =
    originalUniqueDistanceProjectionRevision
  mapStore.processedCount = originalProcessedCount
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

describe("fog worker run state", () => {
  test("notifies progress subscribers only when the count changes", () => {
    mapStore.processedCount = 3
    let notifications = 0
    const unsubscribe = subscribeFogProgress(() => notifications++)

    setFogProcessedCount(3)
    setFogProcessedCount(8)
    setFogProcessedCount(8)
    unsubscribe()
    setFogProcessedCount(13)

    expect(notifications).toBe(1)
    expect(getFogProcessedCount()).toBe(13)
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

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [first],
      mode: "fill",
      kind: "rebuild",
      libraryRevision: 1,
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

    queueAddedActivitiesForFog([second], "fill")

    expectFogRequest(messages[1], {
      generation: 4,
      kind: "append",
      mode: "fill",
      baseLibraryRevision: 1,
      activities: [{ id: second.id, name: second.name, coordinates: second.coordinates }],
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

    postToFogWorker({
      type: "PROCESS_ACTIVITIES",
      activities: [first, second],
      mode: "corridor",
      kind: "rebuild",
      libraryRevision: 1,
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
    libraryRevision: 2,
    fogMode: "corridor",
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    fogData: worldFogGeoJSON(),
  }

  test("accepts the same activity set in any order", () => {
    expect(isFogCacheValid(cache, ["b", "a"], "corridor")).toBe(true)
  })

  test("rejects missing, additional, or differently-modeled activities", () => {
    expect(isFogCacheValid(cache, ["a"], "corridor")).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b", "c"], "corridor")).toBe(false)
    expect(isFogCacheValid(cache, ["a", "b"], "fill")).toBe(false)
  })
})
