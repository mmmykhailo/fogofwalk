import type { Page } from "@playwright/test"

export type PerformanceActivityKind = "metadata" | "geometry"

export interface PerformanceMetrics {
  kind: PerformanceActivityKind
  count: number
  loaderMs: number | null
  idbLoadMs: number | null
  uniqueDistanceMs: number | null
  sortMs: number | null
  firstGridCommitMs: number | null
  navigationMs: number | null
  cardCount: number
  elementCount: number
  heapUsedBytes: number | null
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
  await page.goto("/favicon.ico")
  await page.evaluate(
    async ({ activities, uniqueDistancesCurrent }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("fogofwalk", 3)
        request.onupgradeneeded = () => {
          const database = request.result
          for (const name of [
            "activities",
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
        const transaction = db.transaction(["activities", "prefs"], "readwrite")
        const activityStore = transaction.objectStore("activities")
        activityStore.clear()
        for (const activity of activities) activityStore.put(activity)
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
      const navigation = performance.getEntriesByType("navigation")[0]
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number }
        }
      ).memory

      return {
        kind,
        count,
        loaderMs: duration("activities:loader"),
        idbLoadMs: duration("activities:idb-load"),
        uniqueDistanceMs: duration("activities:unique-distance"),
        sortMs: duration("activities:sort"),
        firstGridCommitMs:
          marks.length > 0 && navigation
            ? marks[0]!.startTime - navigation.startTime
            : null,
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
