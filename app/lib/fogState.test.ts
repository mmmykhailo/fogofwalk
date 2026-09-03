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
import type { ParsedActivity } from "~/types/activities"

const originalWorker = mapStore.worker
const originalRunId = mapStore.runId
const originalPendingFogJobs = mapStore.pendingFogJobs
const originalIsFogRunInFlight = mapStore.isFogRunInFlight
const originalFogWorkerActivityIds = mapStore.fogWorkerActivityIds
const originalFogWorkerMode = mapStore.fogWorkerMode
const originalActivities = mapStore.activities
const originalProcessedCount = mapStore.processedCount

afterEach(() => {
  mapStore.worker = originalWorker
  mapStore.runId = originalRunId
  mapStore.pendingFogJobs = originalPendingFogJobs
  mapStore.isFogRunInFlight = originalIsFogRunInFlight
  mapStore.fogWorkerActivityIds = originalFogWorkerActivityIds
  mapStore.fogWorkerMode = originalFogWorkerMode
  mapStore.activities = originalActivities
  mapStore.processedCount = originalProcessedCount
})

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

  test("stays in flight until every overlapping batch is done", () => {
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

    expect(mapStore.pendingFogJobs).toBe(2)
    expect(mapStore.isFogRunInFlight).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages).toEqual([
      {
        type: "PROCESS_ACTIVITIES",
        activities: [],
        mode: "corridor",
        runId: 7,
      },
      {
        type: "PROCESS_ACTIVITIES",
        activities: [],
        mode: "corridor",
        runId: 7,
      },
    ])

    expect(finishFogJob()).toBe(false)
    expect(mapStore.isFogRunInFlight).toBe(true)
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

    expect(messages).toEqual([
      { type: "RESET", runId: 11 },
      {
        type: "PROCESS_ACTIVITIES",
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
        mode: "corridor",
        runId: 11,
      },
    ])
    expect([...mapStore.fogWorkerActivityIds]).toEqual(["first", "second"])
    expect(mapStore.pendingFogJobs).toBe(1)
  })

  test("queues only missing additions when the worker holds the previous library", () => {
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

    expect(messages).toEqual([
      {
        type: "PROCESS_ACTIVITIES",
        activities: [
          {
            id: second.id,
            name: second.name,
            coordinates: second.coordinates,
          },
        ],
        mode: "fill",
        runId: 4,
      },
    ])
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

    expect(messages).toEqual([
      { type: "RESET", runId: 5 },
      {
        type: "PROCESS_ACTIVITIES",
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
        mode: "corridor",
        runId: 5,
      },
    ])
  })
})

describe("fog cache validity", () => {
  const cache: FogCache = {
    activityIds: ["a", "b"],
    fogMode: "corridor",
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
