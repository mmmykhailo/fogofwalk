import { afterEach, describe, expect, test } from "bun:test"
import {
  finishFogJob,
  mapStore,
  postToFogWorker,
  queueAddedActivitiesForFog,
  worldFogGeoJSON,
} from "./mapStore"
import { isFogCacheValid, type FogCache } from "./storage"
import type { ParsedActivity } from "~/types/activities"

const originalWorker = mapStore.worker
const originalRunId = mapStore.runId
const originalPendingFogJobs = mapStore.pendingFogJobs
const originalIsFogRunInFlight = mapStore.isFogRunInFlight
const originalFogWorkerActivityIds = mapStore.fogWorkerActivityIds
const originalActivities = mapStore.activities

afterEach(() => {
  mapStore.worker = originalWorker
  mapStore.runId = originalRunId
  mapStore.pendingFogJobs = originalPendingFogJobs
  mapStore.isFogRunInFlight = originalIsFogRunInFlight
  mapStore.fogWorkerActivityIds = originalFogWorkerActivityIds
  mapStore.activities = originalActivities
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

    postToFogWorker({ type: "RESET" })

    expect(mapStore.pendingFogJobs).toBe(0)
    expect(mapStore.isFogRunInFlight).toBe(false)
    expect(mapStore.fogWorkerActivityIds.size).toBe(0)
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

    queueAddedActivitiesForFog([second], "corridor")

    expect(messages).toEqual([
      { type: "RESET", runId: 11 },
      {
        type: "PROCESS_ACTIVITIES",
        activities: [first, second],
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

    queueAddedActivitiesForFog([second], "fill")

    expect(messages).toEqual([
      {
        type: "PROCESS_ACTIVITIES",
        activities: [second],
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
    mapStore.pendingFogJobs = 1

    queueAddedActivitiesForFog([second], "corridor")

    expect(messages).toEqual([])
    expect(mapStore.pendingFogJobs).toBe(1)
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
