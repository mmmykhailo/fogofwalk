import type { Page } from "@playwright/test"

export type PerformanceActivityKind =
  | "metadata"
  | "geometry"
  | "compact"
  | "dense"

export interface PerformanceCounters {
  /** Calls that clone the complete activity store, including route geometry. */
  fullActivityLoads: number
  /** Calls that read the summary store used by the library route. */
  activitySummaryReads: number
  /** Requests posted to the unique-distance worker. */
  uniqueDistanceWorkerRequests: number
  homeLoaderStarts: number
  homeBootstrapStarts: number
  homeBootstrapCompletions: number
  photoStoreReads: number
  savedPointStoreReads: number
  preferenceStoreReads: number
  fogWorkerRebuildRequests: number
  fogWorkerAppendRequests: number
  mapSourceSetDataCalls: number
  activityPaintUpdates: number
  mapRouteCommits: number
  mapDialogCommits: number
  visibilityControlCommits: number
  draggableTransformWrites: number
  mapUiNavigations: number
  idbGetCalls: Record<string, number>
  idbGetAllCalls: Record<string, number>
  idbWriteCalls: Record<string, number>
}

export type PerformanceCounterDelta = PerformanceCounters

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

export interface MapGestureMetrics {
  input: "mouse" | "touch"
  frameGaps: number[]
  p50FrameGap: number | null
  p95FrameGap: number | null
  maxFrameGap: number | null
  longTasks: number[]
  counterDelta: PerformanceCounterDelta
  initialCenter: [number, number]
  finalCenter: [number, number]
  initialBearing: number
  finalBearing: number
  renderer: string | null
}

declare global {
  interface Window {
    /** Installed only by the performance E2E fixture before the app loads. */
    __fogofwalkE2ePerformanceCounters?: PerformanceCounters
    __fogofwalkE2eLongTasks?: number[]
    __fogofwalkE2eFrameTimes?: number[]
    __fogofwalkE2eFrameSampling?: boolean
    __fogofwalkE2eFrameHandle?: number
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
      homeLoaderStarts: 0,
      homeBootstrapStarts: 0,
      homeBootstrapCompletions: 0,
      photoStoreReads: 0,
      savedPointStoreReads: 0,
      preferenceStoreReads: 0,
      fogWorkerRebuildRequests: 0,
      fogWorkerAppendRequests: 0,
      mapSourceSetDataCalls: 0,
      activityPaintUpdates: 0,
      mapRouteCommits: 0,
      mapDialogCommits: 0,
      visibilityControlCommits: 0,
      draggableTransformWrites: 0,
      mapUiNavigations: 0,
      idbGetCalls: {},
      idbGetAllCalls: {},
      idbWriteCalls: {},
    }
    window.__fogofwalkE2ePerformanceCounters = counters
    window.__fogofwalkE2eLongTasks = []
    window.__fogofwalkE2eFrameTimes = []

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__fogofwalkE2eLongTasks?.push(entry.duration)
        }
      }).observe({ type: "longtask", buffered: true })
    } catch {
      // Long-task entries are diagnostic and are not available in every engine.
    }

    const sampleFrame = (time: number) => {
      if (!window.__fogofwalkE2ePerformanceCounters) return
      if (!window.__fogofwalkE2eFrameSampling) return
      window.__fogofwalkE2eFrameTimes?.push(time)
      window.__fogofwalkE2eFrameHandle = requestAnimationFrame(sampleFrame)
    }
    ;(
      window as Window & { __startFogofwalkFrameSampling?: () => void }
    ).__startFogofwalkFrameSampling = () => {
      window.__fogofwalkE2eFrameTimes = []
      window.__fogofwalkE2eFrameSampling = true
      window.__fogofwalkE2eFrameHandle = requestAnimationFrame(sampleFrame)
    }
    ;(
      window as Window & { __stopFogofwalkFrameSampling?: () => number[] }
    ).__stopFogofwalkFrameSampling = () => {
      window.__fogofwalkE2eFrameSampling = false
      if (window.__fogofwalkE2eFrameHandle !== undefined) {
        cancelAnimationFrame(window.__fogofwalkE2eFrameHandle)
        delete window.__fogofwalkE2eFrameHandle
      }
      return [...(window.__fogofwalkE2eFrameTimes ?? [])]
    }

    const incrementStoreCounter = (
      countersByStore: Record<string, number>,
      storeName: string
    ) => {
      countersByStore[storeName] = (countersByStore[storeName] ?? 0) + 1
    }

    const originalGetAll = IDBObjectStore.prototype.getAll
    IDBObjectStore.prototype.getAll = function (
      query?: IDBValidKey | IDBKeyRange | null,
      count?: number
    ): IDBRequest<unknown[]> {
      if (this.name === "activities") counters.fullActivityLoads++
      if (this.name === "activity-summaries") counters.activitySummaryReads++
      incrementStoreCounter(counters.idbGetAllCalls, this.name)
      if (arguments.length === 0) return originalGetAll.call(this)
      if (arguments.length === 1) return originalGetAll.call(this, query)
      return originalGetAll.call(this, query, count)
    }

    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (
      query: IDBValidKey | IDBKeyRange
    ): IDBRequest<unknown> {
      incrementStoreCounter(counters.idbGetCalls, this.name)
      return originalGet.call(this, query)
    }

    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey
    ): IDBRequest<IDBValidKey> {
      incrementStoreCounter(counters.idbWriteCalls, this.name)
      if (arguments.length === 1) return originalPut.call(this, value)
      return originalPut.call(this, value, key)
    }

    const originalAdd = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey
    ): IDBRequest<IDBValidKey> {
      incrementStoreCounter(counters.idbWriteCalls, this.name)
      if (arguments.length === 1) return originalAdd.call(this, value)
      return originalAdd.call(this, value, key)
    }

    const originalDelete = IDBObjectStore.prototype.delete
    IDBObjectStore.prototype.delete = function (
      query: IDBValidKey | IDBKeyRange
    ): IDBRequest<undefined> {
      incrementStoreCounter(counters.idbWriteCalls, this.name)
      return originalDelete.call(this, query)
    }

    const originalClear = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.clear = function (): IDBRequest<undefined> {
      incrementStoreCounter(counters.idbWriteCalls, this.name)
      return originalClear.call(this)
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
          kind?: unknown
        }
        if (
          typeof request.requestId === "number" &&
          Array.isArray(request.activities) &&
          request.type === undefined
        ) {
          counters.uniqueDistanceWorkerRequests++
        }
        if (request.type === "PROCESS_ACTIVITIES") {
          if (request.kind === "rebuild") counters.fogWorkerRebuildRequests++
          if (request.kind === "append") counters.fogWorkerAppendRequests++
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
    homeLoaderStarts:
      window.__fogofwalkE2ePerformanceCounters?.homeLoaderStarts ?? 0,
    homeBootstrapStarts:
      window.__fogofwalkE2ePerformanceCounters?.homeBootstrapStarts ?? 0,
    homeBootstrapCompletions:
      window.__fogofwalkE2ePerformanceCounters?.homeBootstrapCompletions ?? 0,
    photoStoreReads:
      window.__fogofwalkE2ePerformanceCounters?.photoStoreReads ?? 0,
    savedPointStoreReads:
      window.__fogofwalkE2ePerformanceCounters?.savedPointStoreReads ?? 0,
    preferenceStoreReads:
      window.__fogofwalkE2ePerformanceCounters?.preferenceStoreReads ?? 0,
    fogWorkerRebuildRequests:
      window.__fogofwalkE2ePerformanceCounters?.fogWorkerRebuildRequests ?? 0,
    fogWorkerAppendRequests:
      window.__fogofwalkE2ePerformanceCounters?.fogWorkerAppendRequests ?? 0,
    mapSourceSetDataCalls:
      window.__fogofwalkE2ePerformanceCounters?.mapSourceSetDataCalls ?? 0,
    activityPaintUpdates:
      window.__fogofwalkE2ePerformanceCounters?.activityPaintUpdates ?? 0,
    mapRouteCommits:
      window.__fogofwalkE2ePerformanceCounters?.mapRouteCommits ?? 0,
    mapDialogCommits:
      window.__fogofwalkE2ePerformanceCounters?.mapDialogCommits ?? 0,
    visibilityControlCommits:
      window.__fogofwalkE2ePerformanceCounters?.visibilityControlCommits ?? 0,
    draggableTransformWrites:
      window.__fogofwalkE2ePerformanceCounters?.draggableTransformWrites ?? 0,
    mapUiNavigations:
      window.__fogofwalkE2ePerformanceCounters?.mapUiNavigations ?? 0,
    idbGetCalls: {
      ...(window.__fogofwalkE2ePerformanceCounters?.idbGetCalls ?? {}),
    },
    idbGetAllCalls: {
      ...(window.__fogofwalkE2ePerformanceCounters?.idbGetAllCalls ?? {}),
    },
    idbWriteCalls: {
      ...(window.__fogofwalkE2ePerformanceCounters?.idbWriteCalls ?? {}),
    },
  }))
}

export async function snapshotPerformanceCounters(
  page: Page
): Promise<PerformanceCounters> {
  return readPerformanceCounters(page)
}

function subtractStoreCounters(
  after: Record<string, number>,
  before: Record<string, number>
): Record<string, number> {
  const keys = new Set([...Object.keys(after), ...Object.keys(before)])
  return Object.fromEntries(
    [...keys].map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)])
  )
}

export function diffPerformanceCounters(
  before: PerformanceCounters,
  after: PerformanceCounters
): PerformanceCounterDelta {
  return {
    fullActivityLoads: after.fullActivityLoads - before.fullActivityLoads,
    activitySummaryReads:
      after.activitySummaryReads - before.activitySummaryReads,
    uniqueDistanceWorkerRequests:
      after.uniqueDistanceWorkerRequests - before.uniqueDistanceWorkerRequests,
    homeLoaderStarts: after.homeLoaderStarts - before.homeLoaderStarts,
    homeBootstrapStarts: after.homeBootstrapStarts - before.homeBootstrapStarts,
    homeBootstrapCompletions:
      after.homeBootstrapCompletions - before.homeBootstrapCompletions,
    photoStoreReads: after.photoStoreReads - before.photoStoreReads,
    savedPointStoreReads:
      after.savedPointStoreReads - before.savedPointStoreReads,
    preferenceStoreReads:
      after.preferenceStoreReads - before.preferenceStoreReads,
    fogWorkerRebuildRequests:
      after.fogWorkerRebuildRequests - before.fogWorkerRebuildRequests,
    fogWorkerAppendRequests:
      after.fogWorkerAppendRequests - before.fogWorkerAppendRequests,
    mapSourceSetDataCalls:
      after.mapSourceSetDataCalls - before.mapSourceSetDataCalls,
    activityPaintUpdates:
      after.activityPaintUpdates - before.activityPaintUpdates,
    mapRouteCommits: after.mapRouteCommits - before.mapRouteCommits,
    mapDialogCommits: after.mapDialogCommits - before.mapDialogCommits,
    visibilityControlCommits:
      after.visibilityControlCommits - before.visibilityControlCommits,
    draggableTransformWrites:
      after.draggableTransformWrites - before.draggableTransformWrites,
    mapUiNavigations: after.mapUiNavigations - before.mapUiNavigations,
    idbGetCalls: subtractStoreCounters(after.idbGetCalls, before.idbGetCalls),
    idbGetAllCalls: subtractStoreCounters(
      after.idbGetAllCalls,
      before.idbGetAllCalls
    ),
    idbWriteCalls: subtractStoreCounters(
      after.idbWriteCalls,
      before.idbWriteCalls
    ),
  }
}

export async function readPerformanceCounterDelta(
  page: Page,
  before: PerformanceCounters
): Promise<PerformanceCounterDelta> {
  return diffPerformanceCounters(before, await readPerformanceCounters(page))
}

export async function waitForMapIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const map = window.__fogofwalkE2eMap
    return Boolean(map && window.__fogofwalkE2eMapStore?.sourcesReady)
  })
  await page.evaluate(() => {
    const map = window.__fogofwalkE2eMap as
      | (FogofwalkE2eMap & {
          isMoving?: () => boolean
          once?: (event: string, listener: () => void) => void
          triggerRepaint?: () => void
        })
      | undefined
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      map.once?.("idle", finish)
      map.triggerRepaint?.()
      if (!map.once) finish()
      window.setTimeout(finish, 2_000)
    })
  })
  await page.waitForFunction(() => {
    const map = window.__fogofwalkE2eMap as
      | (FogofwalkE2eMap & {
          getCenter?: () => { lng: number; lat: number }
          isMoving?: () => boolean
        })
      | undefined
    if (!map?.getCenter) return false
    return new Promise<boolean>((resolve) => {
      let previous: { lng: number; lat: number } | null = null
      let stableFrames = 0
      const check = () => {
        const center = map.getCenter!()
        const stable =
          !map.isMoving?.() &&
          previous !== null &&
          Math.abs(center.lng - previous.lng) < 1e-12 &&
          Math.abs(center.lat - previous.lat) < 1e-12
        stableFrames = stable ? stableFrames + 1 : 0
        previous = center
        if (stableFrames >= 3) resolve(true)
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
  })
}

function percentile(
  values: readonly number[],
  fraction: number
): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1
  )
  return sorted[Math.max(0, index)] ?? null
}

async function mapViewport(page: Page): Promise<{
  x: number
  y: number
  width: number
  height: number
}> {
  const bounds = await page.locator(".maplibregl-canvas").first().boundingBox()
  if (!bounds) throw new Error("Map canvas is not visible")
  return bounds
}

async function moveMouseGesture(
  page: Page,
  bounds: { x: number; y: number; width: number; height: number }
): Promise<void> {
  // A preceding diagnostic click can be interrupted by a client navigation;
  // release any button Playwright still considers pressed before the sample.
  await page.mouse.up()
  const y = bounds.y + bounds.height * 0.5
  const startX = bounds.x + bounds.width * 0.65
  const endX = bounds.x + bounds.width * 0.35
  await page.mouse.move(startX, y)
  await page.mouse.down()
  const moves = 80
  for (let index = 1; index <= moves; index++) {
    const progress = index / moves
    await page.mouse.move(startX + (endX - startX) * progress, y)
    await page.waitForTimeout(1_000 / moves)
  }
  await page.mouse.up()
}

async function dispatchTouchGesture(
  page: Page,
  bounds: { x: number; y: number; width: number; height: number },
  rotate: boolean
): Promise<void> {
  const client = await page.context().newCDPSession(page)
  const send = (
    type: "touchStart" | "touchMove" | "touchEnd",
    touchPoints: {
      x: number
      y: number
      id: number
      radiusX: number
      radiusY: number
      force: number
    }[]
  ) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints,
    })
  const point = (x: number, y: number, id: number) => ({
    x,
    y,
    id,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  })

  try {
    const centerY = bounds.y + bounds.height * 0.5
    const primaryX = bounds.x + bounds.width * 0.65
    const endX = bounds.x + bounds.width * 0.35
    await send("touchStart", [point(primaryX, centerY, 1)])
    for (let index = 1; index <= 80; index++) {
      const progress = index / 80
      await page.waitForTimeout(1_000 / 80)
      await send("touchMove", [
        point(primaryX + (endX - primaryX) * progress, centerY, 1),
      ])
    }
    await send("touchEnd", [])

    if (!rotate) return
    const centerX = bounds.x + bounds.width * 0.5
    const rotateCenterY = bounds.y + bounds.height * 0.5
    const radius = Math.min(bounds.width, bounds.height) * 0.18
    const startAngle = -Math.PI * 0.35
    const endAngle = Math.PI * 0.35
    const rotatedPoint = (angle: number, sign: 1 | -1, id: number) =>
      point(
        centerX + Math.cos(angle) * radius * sign,
        rotateCenterY + Math.sin(angle) * radius * sign,
        id
      )
    await send("touchStart", [
      rotatedPoint(startAngle, 1, 1),
      rotatedPoint(startAngle, -1, 2),
    ])
    for (let index = 1; index <= 30; index++) {
      const angle = startAngle + ((endAngle - startAngle) * index) / 30
      await page.waitForTimeout(1_000 / 30)
      await send("touchMove", [
        rotatedPoint(angle, 1, 1),
        rotatedPoint(angle, -1, 2),
      ])
    }
    await send("touchEnd", [])
  } finally {
    await client.detach().catch(() => undefined)
  }
}

export async function sampleMapGesture(
  page: Page,
  options: { input?: "mouse" | "touch"; rotate?: boolean } = {}
): Promise<MapGestureMetrics> {
  await waitForMapIdle(page)
  const before = await snapshotPerformanceCounters(page)
  const bounds = await mapViewport(page)
  const initial = await page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    const liveMap = map as unknown as {
      getCenter: () => { lng: number; lat: number }
      getBearing: () => number
    }
    return {
      center: [liveMap.getCenter().lng, liveMap.getCenter().lat] as [
        number,
        number,
      ],
      bearing: liveMap.getBearing(),
    }
  })
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
    window.__fogofwalkE2eLongTasks = []
    ;(
      window as Window & { __startFogofwalkFrameSampling?: () => void }
    ).__startFogofwalkFrameSampling?.()
  })
  await page.waitForTimeout(250)
  if (options.input === "touch") {
    await dispatchTouchGesture(page, bounds, options.rotate ?? false)
  } else {
    await moveMouseGesture(page, bounds)
  }
  await page.waitForFunction(() => {
    const map = window.__fogofwalkE2eMap as unknown as {
      isMoving?: () => boolean
    }
    return !map?.isMoving?.()
  })
  await waitForMapIdle(page)
  await page.waitForTimeout(250)
  const sampled = await page.evaluate(() => {
    const frames =
      (
        window as Window & {
          __stopFogofwalkFrameSampling?: () => number[]
        }
      ).__stopFogofwalkFrameSampling?.() ?? []
    const longTasks = [...(window.__fogofwalkE2eLongTasks ?? [])]
    return { frames, longTasks }
  })
  const after = await snapshotPerformanceCounters(page)
  const final = await page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    const liveMap = map as unknown as {
      getCenter: () => { lng: number; lat: number }
      getBearing: () => number
    }
    return {
      center: [liveMap.getCenter().lng, liveMap.getCenter().lat] as [
        number,
        number,
      ],
      bearing: liveMap.getBearing(),
      renderer: (() => {
        const context =
          map.getCanvas().getContext("webgl2") ??
          map.getCanvas().getContext("webgl")
        if (!context) return null
        const debug = context.getExtension("WEBGL_debug_renderer_info")
        return debug
          ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER)
      })(),
    }
  })
  const frameGaps = sampled.frames
    .slice(1)
    .map((time, index) => time - sampled.frames[index]!)
  return {
    input: options.input ?? "mouse",
    frameGaps,
    p50FrameGap: percentile(frameGaps, 0.5),
    p95FrameGap: percentile(frameGaps, 0.95),
    maxFrameGap: frameGaps.length > 0 ? Math.max(...frameGaps) : null,
    longTasks: sampled.longTasks,
    counterDelta: diffPerformanceCounters(before, after),
    initialCenter: initial.center,
    finalCenter: final.center,
    initialBearing: initial.bearing,
    finalBearing: final.bearing,
    renderer: typeof final.renderer === "string" ? final.renderer : null,
  }
}

function makeActivity(index: number, kind: PerformanceActivityKind) {
  const pointCount =
    kind === "metadata"
      ? 2
      : kind === "dense"
        ? 256
        : kind === "compact"
          ? 8
          : 64
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
      distanceKm: pointCount <= 8 ? 1 + (index % 10) / 10 : 6.4,
      uniqueDistanceKm: pointCount <= 8 ? 1 + (index % 10) / 10 : 6.4,
      elevationGainM: pointCount <= 8 ? 0 : 120 + (index % 20),
      elevationLossM: pointCount <= 8 ? 0 : 95 + (index % 20),
      hasElevation: pointCount > 8,
      durationMs: 3_600_000,
      movingTimeMs: 3_300_000,
      avgPaceMinPerKm: 6,
      avgMovingPaceMinPerKm: 5.5,
      avgSpeedKmh: 10,
      avgMovingSpeedKmh: 10.9,
      elevationProfile:
        pointCount <= 8
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
  // Use an HTML shell so Playwright does not report ERR_ABORTED for an image
  // navigation in the production static server.
  await page.goto("/404.html")
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
  await page.goto("/404.html")
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
  activityIds: string[]
  summaryIds: string[]
}> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const stored = await new Promise<{
      activityCount: number
      summaryCount: number
      activityIds: string[]
      summaryIds: string[]
    }>((resolve, reject) => {
      const transaction = db.transaction(
        ["activities", "activity-summaries"],
        "readonly"
      )
      const activityCount = transaction.objectStore("activities").count()
      const summaryCount = transaction.objectStore("activity-summaries").count()
      const activityKeys = transaction.objectStore("activities").getAllKeys()
      const summaryKeys = transaction
        .objectStore("activity-summaries")
        .getAllKeys()
      let activities: number | undefined
      let summaries: number | undefined
      let activityIds: string[] | undefined
      let summaryIds: string[] | undefined
      const finish = () => {
        if (
          activities !== undefined &&
          summaries !== undefined &&
          activityIds !== undefined &&
          summaryIds !== undefined
        ) {
          resolve({
            activityCount: activities,
            summaryCount: summaries,
            activityIds,
            summaryIds,
          })
        }
      }
      activityCount.onsuccess = () => {
        activities = activityCount.result
        finish()
      }
      summaryCount.onsuccess = () => {
        summaries = summaryCount.result
        finish()
      }
      activityKeys.onsuccess = () => {
        activityIds = activityKeys.result.filter(
          (id): id is string => typeof id === "string"
        )
        finish()
      }
      summaryKeys.onsuccess = () => {
        summaryIds = summaryKeys.result.filter(
          (id): id is string => typeof id === "string"
        )
        finish()
      }
      transaction.onerror = () => reject(transaction.error)
    })
    const result = { version: db.version, ...stored }
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
