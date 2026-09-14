import { initializeActivityLibrary, mapStore } from "~/lib/mapStore"
import {
  isFogCacheValid,
  loadFogCache,
  loadFogMode,
  loadPhotos,
  loadSavedPoints,
} from "~/lib/storage"
import {
  incrementPerformanceCounter,
  markPerformance,
  measurePerformance,
} from "~/lib/performance"
import type { FogMode, ParsedActivity } from "~/types/activities"
import type { PhotoEntry } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"

export interface MapBootstrapData {
  generation: number
  activityCount: number
  fogMode: FogMode
  photos: PhotoEntry[]
  savedPoints: SavedPoint[]
  fogCacheRestored: boolean
}

export type MapBootstrapState =
  | { status: "idle" }
  | { status: "loading"; promise: Promise<MapBootstrapData> }
  | { status: "ready"; generation: number; data: MapBootstrapData }
  | { status: "failed"; error: unknown }

type MapBootstrapCachePatch = Partial<
  Pick<MapBootstrapData, "activityCount" | "fogMode" | "photos" | "savedPoints">
>

let bootstrapState: MapBootstrapState = { status: "idle" }
let nextGeneration = 0
let pendingCachePatch: MapBootstrapCachePatch = {}

function restoreFogCache(
  activities: readonly ParsedActivity[],
  fogMode: FogMode,
  fogCache: Awaited<ReturnType<typeof loadFogCache>>
): boolean {
  if (
    activities.length > 0 &&
    fogCache &&
    isFogCacheValid(
      fogCache,
      activities.map((activity) => activity.id).sort(),
      fogMode,
      mapStore.coverageRevision
    )
  ) {
    mapStore.fogData = fogCache.fogData
    return true
  }
  mapStore.fogData = null
  return false
}

async function readMapBootstrap(): Promise<MapBootstrapData> {
  markPerformance("home:idb-load:start")
  const [activities, photos, savedPoints, fogModeValue, fogCache] =
    await Promise.all([
      initializeActivityLibrary(),
      loadPhotos(),
      loadSavedPoints(),
      loadFogMode(),
      loadFogCache(),
    ])
  markPerformance("home:idb-load:end")
  measurePerformance(
    "home:idb-load",
    "home:idb-load:start",
    "home:idb-load:end"
  )
  const fogMode = fogModeValue ?? "corridor"
  mapStore.fogMode = fogMode
  const fogCacheRestored = restoreFogCache(activities, fogMode, fogCache)
  const generation = ++nextGeneration
  const data: MapBootstrapData = {
    generation,
    activityCount: activities.length,
    fogMode,
    photos,
    savedPoints,
    fogCacheRestored,
  }
  const patchedData = {
    ...data,
    ...pendingCachePatch,
  }
  pendingCachePatch = {}
  return patchedData
}

/** Ensure the local map data is read once and published as one consistent generation. */
export function ensureMapBootstrap(): Promise<MapBootstrapData> {
  if (bootstrapState.status === "ready") {
    return Promise.resolve(bootstrapState.data)
  }
  if (bootstrapState.status === "loading") return bootstrapState.promise
  if (bootstrapState.status === "failed") {
    bootstrapState = { status: "idle" }
  }

  incrementPerformanceCounter("homeBootstrapStarts")
  const promise = readMapBootstrap()
  bootstrapState = { status: "loading", promise }
  promise.then(
    (data) => {
      bootstrapState = { status: "ready", generation: data.generation, data }
      incrementPerformanceCounter("homeBootstrapCompletions")
    },
    (error) => {
      // A failed attempt must not poison an explicit retry. Until a complete
      // generation exists, keep any already-live map data authoritative.
      bootstrapState = { status: "failed", error }
    }
  )
  return promise
}

/** Read the current coordinator state without starting a bootstrap. */
export function getMapBootstrapState(): MapBootstrapState {
  return bootstrapState
}

/** Update a ready (or in-flight) bootstrap cache after a durable local mutation. */
export function updateMapBootstrapCache(patch: MapBootstrapCachePatch): void {
  if (bootstrapState.status === "ready") {
    const data = { ...bootstrapState.data, ...patch }
    bootstrapState = {
      status: "ready",
      generation: data.generation,
      data,
    }
    return
  }
  pendingCachePatch = { ...pendingCachePatch, ...patch }
}

/** Keep the map cache's activity count aligned with the canonical library. */
export function updateMapBootstrapActivityCount(
  activities: readonly ParsedActivity[]
): void {
  updateMapBootstrapCache({
    activityCount: activities.length,
  })
}
