import type { Page } from "@playwright/test"

export type PerformanceActivityKind = "metadata" | "geometry"

export interface PerformanceCounters {
  /** Calls that clone the complete activity store, including route geometry. */
  fullActivityLoads: number
  /** Calls that read the summary store used by the library route. */
  activitySummaryReads: number
  /** Requests posted to the unique-distance worker. */
  uniqueDistanceWorkerRequests: number
}

export interface PerformanceMetrics {
  kind: PerformanceActivityKind
  count: number
  homeLoaderMs: number | null
  homeIdbLoadMs: number | null
  loaderMs: number | null
  idbLoadMs: number | null
  uniqueDistanceMs: number | null
  sortMs: number | null
  firstGridCommitMs: number | null
  gridCommitCount: number
  navigationMs: number | null
  cardCount: number
  elementCount: number
  heapUsedBytes: number | null
}

declare global {
  interface Window {
    /** Installed only by the performance E2E fixture before the app loads. */
    __fogofwalkE2ePerformanceCounters?: PerformanceCounters
  }
}

/** Install counters before a navigation so the app's own reads are observable. */
export async function installPerformanceCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.__fogofwalkE2ePerformanceCounters) return

    const counters: PerformanceCounters = {
      fullActivityLoads: 0,
      activitySummaryReads: 0,
      uniqueDistanceWorkerRequests: 0,
    }
    window.__fogofwalkE2ePerformanceCounters = counters

    const originalGetAll = IDBObjectStore.prototype.getAll
    IDBObjectStore.prototype.getAll = function (
      query?: IDBValidKey | IDBKeyRange | null,
      count?: number
    ): IDBRequest<unknown[]> {
      if (this.name === "activities") counters.fullActivityLoads++
      if (this.name === "activity-summaries") counters.activitySummaryReads++
      return originalGetAll.call(this, query, count)
    }

    const originalPostMessage = Worker.prototype.postMessage as unknown as (
      this: Worker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions
    ) => void
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions
    ): void {
      if (message != null && typeof message === "object") {
        const request = message as {
          requestId?: unknown
          activities?: unknown
          type?: unknown
        }
        if (
          typeof request.requestId === "number" &&
          Array.isArray(request.activities) &&
          request.type === undefined
        ) {
          counters.uniqueDistanceWorkerRequests++
        }
      }
      if (options === undefined) originalPostMessage.call(this, message)
      else originalPostMessage.call(this, message, options)
    }
  })
}

export async function readPerformanceCounters(
  page: Page
): Promise<PerformanceCounters> {
  return page.evaluate(() => ({
    fullActivityLoads:
      window.__fogofwalkE2ePerformanceCounters?.fullActivityLoads ?? 0,
    activitySummaryReads:
      window.__fogofwalkE2ePerformanceCounters?.activitySummaryReads ?? 0,
    uniqueDistanceWorkerRequests:
      window.__fogofwalkE2ePerformanceCounters?.uniqueDistanceWorkerRequests ??
      0,
  }))
}

function makeActivity(index: number, kind: PerformanceActivityKind) {
  const pointCount = kind === "metadata" ? 2 : 64
  const baseLng = -90 + (index % 200) * 0.01
  const baseLat = 40 + Math.floor(index / 200) * 0.01
  const coordinates = Array.from(
    { length: pointCount },
    (_, pointIndex) =>
      [
        baseLng + pointIndex * 0.0001,
        baseLat + Math.sin(pointIndex / 4) * 0.0001,
      ] as [number, number]
  )
  const pointTimestamps = coordinates.map(
    (_, pointIndex) =>
      1_700_000_000_000 + index * 86_400_000 + pointIndex * 60_000
  )

  return {
    id: `performance-${kind}-${index}`,
    name: `performance-${String(index).padStart(4, "0")}.gpx`,
    startedAtMs: pointTimestamps[0],
    coordinates,
    pointTimestamps,
    format: "gpx" as const,
    contentHash: `performance-hash-${kind}-${index}`,
    activityType: index % 3 === 0 ? "running" : "walking",
    isPublic: false,
    stats: {
      distanceKm: pointCount === 2 ? 1 + (index % 10) / 10 : 6.4,
      uniqueDistanceKm: pointCount === 2 ? 1 + (index % 10) / 10 : 6.4,
      elevationGainM: pointCount === 2 ? 0 : 120 + (index % 20),
      elevationLossM: pointCount === 2 ? 0 : 95 + (index % 20),
      hasElevation: pointCount > 2,
      durationMs: 3_600_000,
      movingTimeMs: 3_300_000,
      avgPaceMinPerKm: 6,
      avgMovingPaceMinPerKm: 5.5,
      avgSpeedKmh: 10,
      avgMovingSpeedKmh: 10.9,
      elevationProfile:
        pointCount === 2
          ? []
          : coordinates.map((_, pointIndex) => 100 + (pointIndex % 30)),
    },
  }
}

export function makePerformanceActivities(
  count: number,
  kind: PerformanceActivityKind
) {
  return Array.from({ length: count }, (_, index) => makeActivity(index, kind))
}

export async function seedPerformanceDatabase(
  page: Page,
  activities: ReturnType<typeof makePerformanceActivities>,
  uniqueDistancesCurrent: boolean
): Promise<void> {
  await installPerformanceCounters(page)
  await page.goto("/favicon.ico")
  await page.evaluate(
    async ({ activities, uniqueDistancesCurrent }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("fogofwalk", 4)
        request.onupgradeneeded = () => {
          const database = request.result
          for (const name of [
            "activities",
            "activity-summaries",
            "photos",
            "saved-points",
            "prefs",
          ]) {
            if (!database.objectStoreNames.contains(name)) {
              database.createObjectStore(name, {
                keyPath: name === "prefs" ? "key" : "id",
              })
            }
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(
          ["activities", "activity-summaries", "prefs"],
          "readwrite"
        )
        const activityStore = transaction.objectStore("activities")
        const summaryStore = transaction.objectStore("activity-summaries")
        activityStore.clear()
        summaryStore.clear()
        for (const activity of activities) activityStore.put(activity)
        for (const activity of activities) {
          summaryStore.put({
            id: activity.id,
            name: activity.name,
            startedAtMs: activity.startedAtMs,
            activityType: activity.activityType,
            contentHash: activity.contentHash,
            isPublic: activity.isPublic,
            stats: {
              distanceKm: activity.stats.distanceKm,
              durationMs: activity.stats.durationMs,
              elevationGainM: activity.stats.elevationGainM,
              avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
            },
          })
        }
        transaction.objectStore("prefs").put({
          key: "uniqueDistanceState",
          value: {
            version: 1,
            activityIds: uniqueDistancesCurrent
              ? activities.map((activity) => activity.id)
              : [],
          },
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      db.close()
    },
    { activities, uniqueDistancesCurrent }
  )
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })
}

/** Seed the pre-summary schema so the production upgrade path is exercised. */
export async function seedLegacyV3Database(
  page: Page,
  activity: ReturnType<typeof makePerformanceActivities>[number]
): Promise<void> {
  await installPerformanceCounters(page)
  await page.goto("/favicon.ico")
  await page.evaluate(async (activity) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("fogofwalk")
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () =>
        reject(new Error("legacy database deletion blocked"))
    })

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk", 3)
      request.onupgradeneeded = () => {
        const database = request.result
        for (const name of ["activities", "photos", "saved-points", "prefs"]) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, {
              keyPath: name === "prefs" ? "key" : "id",
            })
          }
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("activities", "readwrite")
      transaction.objectStore("activities").put(activity)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
  }, activity)
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })
}

/** Replace the summary store with a malformed record for recovery coverage. */
export async function corruptPerformanceSummary(
  page: Page,
  activityId: string
): Promise<void> {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("activity-summaries", "readwrite")
      transaction.objectStore("activity-summaries").put({ id, name: "broken" })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
  }, activityId)
}

export async function readActivityStorage(page: Page): Promise<{
  version: number
  activityCount: number
  summaryCount: number
}> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const counts = await new Promise<{
      activityCount: number
      summaryCount: number
    }>((resolve, reject) => {
      const transaction = db.transaction(
        ["activities", "activity-summaries"],
        "readonly"
      )
      const activityCount = transaction.objectStore("activities").count()
      const summaryCount = transaction.objectStore("activity-summaries").count()
      let activities: number | undefined
      let summaries: number | undefined
      activityCount.onsuccess = () => {
        activities = activityCount.result
        if (summaries !== undefined)
          resolve({ activityCount: activities, summaryCount: summaries })
      }
      summaryCount.onsuccess = () => {
        summaries = summaryCount.result
        if (activities !== undefined)
          resolve({ activityCount: activities, summaryCount: summaries })
      }
      transaction.onerror = () => reject(transaction.error)
    })
    const result = { version: db.version, ...counts }
    db.close()
    return result
  })
}

export async function readPerformanceMetrics(
  page: Page,
  kind: PerformanceActivityKind,
  count: number
): Promise<PerformanceMetrics> {
  return page.evaluate(
    ({ kind, count }) => {
      const duration = (name: string): number | null => {
        const entries = performance.getEntriesByName(name, "measure")
        return entries.length > 0 ? entries[entries.length - 1]!.duration : null
      }
      const marks = performance.getEntriesByName(
        "activities:grid:commit",
        "mark"
      )
      const navigationEntries = performance.getEntriesByType("navigation")
      const navigation = navigationEntries[navigationEntries.length - 1]
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number }
        }
      ).memory

      return {
        kind,
        count,
        homeLoaderMs: duration("home:loader"),
        homeIdbLoadMs: duration("home:idb-load"),
        loaderMs: duration("activities:loader"),
        idbLoadMs: duration("activities:idb-load"),
        uniqueDistanceMs: duration("activities:unique-distance"),
        sortMs: duration("activities:sort"),
        firstGridCommitMs:
          marks.length > 0 && navigation
            ? marks[0]!.startTime - navigation.startTime
            : null,
        gridCommitCount: marks.length,
        navigationMs: navigation?.duration ?? null,
        cardCount: document.querySelectorAll('[data-testid^="activity-card-"]')
          .length,
        elementCount: document.querySelectorAll("*").length,
        heapUsedBytes: memory?.usedJSHeapSize ?? null,
      }
    },
    { kind, count }
  )
}
