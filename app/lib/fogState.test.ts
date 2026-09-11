import { afterEach, describe, expect, test } from "bun:test"
import {
  finishFogJob,
  getFogProcessedCount,
  mapStore,
  postToFogWorker,
  queueAddedActivitiesForFog,
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
const originalPendingFogJobs = mapStore.pendingFogJobs
const originalIsFogRunInFlight = mapStore.isFogRunInFlight
const originalFogWorkerActivityIds = mapStore.fogWorkerActivityIds
const originalFogWorkerMode = mapStore.fogWorkerMode
const originalFogWorkerLibraryRevision = mapStore.fogWorkerLibraryRevision
const originalFogSnapshot = mapStore.fogSnapshot
const originalActivities = mapStore.activities
const originalLibraryRevision = mapStore.libraryRevision
const originalProcessedCount = mapStore.processedCount

afterEach(() => {
  // The production map store owns one coordinator for the lifetime of the
  // module. Clear it between tests so an active/queued request from one test
  // cannot be mistaken for the worker state of the next test.
  mapStore.worker = { postMessage() {} } as unknown as Worker
  postToFogWorker({ type: "RESET" })
  mapStore.worker = originalWorker
  mapStore.runId = originalRunId
  mapStore.pendingFogJobs = originalPendingFogJobs
  mapStore.isFogRunInFlight = originalIsFogRunInFlight
  mapStore.fogWorkerActivityIds = originalFogWorkerActivityIds
  mapStore.fogWorkerMode = originalFogWorkerMode
  mapStore.fogWorkerLibraryRevision = originalFogWorkerLibraryRevision
  mapStore.fogSnapshot = originalFogSnapshot
  mapStore.activities = originalActivities
  mapStore.libraryRevision = originalLibraryRevision
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

  test("coalesces overlapping batches and stays in flight", () => {
    const messages: unknown[] = []
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.runId = 7
    mapStore.pendingFogJobs = 0
    mapStore.isFogRunInFlight = false
    mapStore.fogWorkerMode = null

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

    expect(mapStore.pendingFogJobs).toBe(1)
    expect(mapStore.isFogRunInFlight).toBe(true)
    expect(messages).toHaveLength(1)
    expectFogRequest(messages[0], {
      generation: 7,
      kind: "rebuild",
      mode: "corridor",
    })

    expect(finishFogJob()).toBe(true)
    expect(mapStore.isFogRunInFlight).toBe(false)
  })

  test("reset abandons all outstanding batches", () => {
    mapStore.worker = { postMessage() {} } as unknown as Worker
    mapStore.pendingFogJobs = 2
    mapStore.isFogRunInFlight = true
    mapStore.fogWorkerActivityIds = new Set(["old"])
    mapStore.fogWorkerMode = "fill"

    postToFogWorker({ type: "RESET" })

    expect(mapStore.pendingFogJobs).toBe(0)
    expect(mapStore.isFogRunInFlight).toBe(false)
    expect(mapStore.fogWorkerActivityIds.size).toBe(0)
    expect(mapStore.fogWorkerMode).toBeNull()
  })

  test("does not record a process job when the worker is unavailable", () => {
    mapStore.worker = null
    mapStore.pendingFogJobs = 0
    mapStore.isFogRunInFlight = false
    mapStore.fogWorkerActivityIds = new Set()
    mapStore.fogWorkerMode = null

    expect(
      postToFogWorker({
        type: "PROCESS_ACTIVITIES",
        activities: [activity("missing-worker")],
        mode: "corridor",
      })
    ).toBe(false)
    expect(mapStore.pendingFogJobs).toBe(0)
    expect(mapStore.isFogRunInFlight).toBe(false)
    expect(mapStore.fogWorkerActivityIds.size).toBe(0)
    expect(mapStore.fogWorkerMode).toBeNull()
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
    mapStore.pendingFogJobs = 0
    mapStore.isFogRunInFlight = false
    mapStore.fogWorkerActivityIds = new Set()
    mapStore.fogWorkerMode = null

    queueAddedActivitiesForFog([second], "corridor")

    expectFogRequest(messages[0], {
      generation: 11,
      kind: "cancel",
      mode: "corridor",
    })
    expectFogRequest(messages[1], {
      generation: 11,
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
    expect([...mapStore.fogWorkerActivityIds]).toEqual(["first", "second"])
    expect(mapStore.pendingFogJobs).toBe(1)
  })

  test("rebuilds when legacy worker bookkeeping has no coordinator base", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.runId = 4
    mapStore.pendingFogJobs = 0
    mapStore.fogWorkerActivityIds = new Set([first.id])
    mapStore.fogWorkerMode = "fill"

    queueAddedActivitiesForFog([second], "fill")

    expectFogRequest(messages[0], {
      generation: 4,
      kind: "rebuild",
      mode: "fill",
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

  test("does not duplicate an addition already covered by a concurrent rebuild", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.fogWorkerActivityIds = new Set([first.id, second.id])
    mapStore.fogWorkerMode = "corridor"
    mapStore.pendingFogJobs = 1

    queueAddedActivitiesForFog([second], "corridor")

    expect(messages).toEqual([])
    expect(mapStore.pendingFogJobs).toBe(1)
  })

  test("rebuilds instead of mixing fill and corridor batches", () => {
    const messages: unknown[] = []
    const first = activity("first")
    const second = activity("second")
    mapStore.worker = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    } as unknown as Worker
    mapStore.activities = [first, second]
    mapStore.runId = 4
    mapStore.pendingFogJobs = 0
    mapStore.fogWorkerActivityIds = new Set([first.id])
    mapStore.fogWorkerMode = "fill"

    queueAddedActivitiesForFog([second], "corridor")

    expectFogRequest(messages[0], {
      generation: 5,
      kind: "cancel",
      mode: "corridor",
    })
    expectFogRequest(messages[1], {
      generation: 5,
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
