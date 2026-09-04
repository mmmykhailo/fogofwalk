import type maplibregl from "maplibre-gl"
import type {
  ParsedActivity,
  FogMode,
  WorkerInboundMessage,
} from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"
import { sortActivities } from "~/lib/statsAggregator"
import { clearFogCache, loadActivities } from "~/lib/storage"
import { ensureUniqueDistancesCurrent } from "~/lib/uniqueDistanceRepair"
import { worldFogFeature } from "~/lib/fogGeometry"

// ─── Map position persistence (localStorage — synchronous, survives page unload) ──

const MAP_POSITION_KEY = "fogofwalk:mapPosition"

interface SavedMapPosition {
  center: [number, number]
  zoom: number
}

/** Write the current map position synchronously. Call on every moveend. */
export function saveMapPosition(center: [number, number], zoom: number): void {
  try {
    localStorage.setItem(MAP_POSITION_KEY, JSON.stringify({ center, zoom }))
  } catch {
    // localStorage unavailable (private browsing with storage blocked, etc.)
  }
}

/** Remove the saved map position (called by clear-all). */
export function clearMapPosition(): void {
  try {
    localStorage.removeItem(MAP_POSITION_KEY)
  } catch {}
}

/** Read the saved position synchronously at module-init time. */
function readSavedMapPosition(): SavedMapPosition | null {
  try {
    const raw = localStorage.getItem(MAP_POSITION_KEY)
    if (!raw) return null
    const { center, zoom } = JSON.parse(raw)
    if (
      Array.isArray(center) &&
      center.length === 2 &&
      typeof zoom === "number"
    ) {
      return { center: center as [number, number], zoom }
    }
    return null
  } catch {
    return null
  }
}

// Loaded once at module init — synchronous, so always ready before any useEffect runs.
const _savedPosition =
  typeof window !== "undefined" ? readSavedMapPosition() : null

// ─── Store ────────────────────────────────────────────────────────────────────

export type ActivityHydration = "unloaded" | "summaries" | "full"

interface MapStore {
  map: maplibregl.Map | null
  worker: Worker | null
  fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  activities: ParsedActivity[]
  activitySummaries: ActivitySummary[]
  activityHydration: ActivityHydration
  isProcessing: boolean
  processedCount: number
  sourcesReady: boolean
  /** Current fog mode — kept in sync with React state so MapView can read it without a prop. */
  fogMode: FogMode
  /** Map center restored from localStorage; used once by MapView on initialization. */
  initialCenter: [number, number] | null
  /** Map zoom restored from localStorage; used once by MapView on initialization. */
  initialZoom: number | null
  /**
   * True when activities were restored but the fog cache was stale, triggering a
   * worker reprocess. MapView skips fitBounds in this case so the saved map
   * position is preserved.
   */
  isRestoreReprocess: boolean
  /**
   * Generation token for fog-worker runs. Bumped by `startFogRun()` wherever
   * the app abandons in-flight work (fog-mode toggle, delete-activity, clear-all).
   * Every message to and from the worker carries it.
   */
  runId: number
  /**
   * True between posting PROCESS_ACTIVITIES and the matching DONE.
   *
   * The progress UI cannot just assume work is outstanding after an action:
   * the worker can finish a small batch *before* the action returns, since the
   * action still has IDB writes (and, when signed in, a network round trip) to
   * get through. Setting `isProcessing` unconditionally in that window strands
   * "Processing 0 of N…" forever, because the only thing that clears it — DONE
   * — has already been and gone.
   */
  isFogRunInFlight: boolean
  /** Number of PROCESS_ACTIVITIES messages in the current run awaiting DONE. */
  pendingFogJobs: number
  /** Activity ids contained in, or already queued for, the current worker run. */
  fogWorkerActivityIds: Set<string>
  /** Fog mode used to build the current worker run's internal accumulators. */
  fogWorkerMode: FogMode | null
  /** True once MapView is ready to receive fog-worker replies. */
  isFogWorkerListenerReady: boolean
  /**
   * In-memory cache of the last share-card map render. Avoids re-creating a
   * WebGL context on every dialog open. Keyed by activityId. The ImageBitmap is
   * owned by this cache — call .close() before replacing or clearing it.
   */
  shareCardCache: {
    activityId: string
    baseMap: ImageBitmap
    activityPoints: { x: number; y: number }[]
  } | null
}

export const mapStore: MapStore = {
  map: null,
  worker: null,
  fogData: null,
  activities: [],
  activitySummaries: [],
  activityHydration: "unloaded",
  isProcessing: false,
  processedCount: 0,
  sourcesReady: false,
  fogMode: "corridor",
  initialCenter: _savedPosition?.center ?? null,
  initialZoom: _savedPosition?.zoom ?? null,
  isRestoreReprocess: false,
  runId: 0,
  isFogRunInFlight: false,
  pendingFogJobs: 0,
  fogWorkerActivityIds: new Set(),
  fogWorkerMode: null,
  isFogWorkerListenerReady: false,
  shareCardCache: null,
}

/** Replace the in-memory full library and make its hydration state explicit. */
export function setFullActivities(activities: ParsedActivity[]): void {
  mapStore.activities = activities
  mapStore.activitySummaries = []
  mapStore.activityHydration = "full"
}

/** Replace the lightweight library used by non-map routes. */
export function setActivitySummaries(summaries: ActivitySummary[]): void {
  mapStore.activitySummaries = summaries
  mapStore.activityHydration = "summaries"
}

/** Update the summary cache after a metadata-only edit. */
export function updateActivitySummaries(
  updates: readonly ActivitySummary[]
): void {
  if (mapStore.activityHydration !== "summaries") return
  const byId = new Map(updates.map((activity) => [activity.id, activity]))
  mapStore.activitySummaries = mapStore.activitySummaries.map(
    (activity) => byId.get(activity.id) ?? activity
  )
}

export function clearFullActivities(): void {
  setFullActivities([])
}

let fullHydration: Promise<ParsedActivity[]> | null = null

/** Coalesced full-library hydrator for map, stats, fog, sharing, and sync. */
export function hydrateFullActivities(): Promise<ParsedActivity[]> {
  if (mapStore.activityHydration === "full") {
    return Promise.resolve(mapStore.activities)
  }
  if (fullHydration) return fullHydration
  fullHydration = loadActivities()
    .then((activities) => {
      setFullActivities(sortActivities(activities))
      return mapStore.activities
    })
    .finally(() => {
      fullHydration = null
    })
  return fullHydration
}

const fogProgressListeners = new Set<() => void>()

/** Subscribe narrowly to worker progress without rerendering the home route. */
export function subscribeFogProgress(listener: () => void): () => void {
  fogProgressListeners.add(listener)
  return () => fogProgressListeners.delete(listener)
}

export function getFogProcessedCount(): number {
  return mapStore.processedCount
}

/** Update worker progress and notify only the UI that displays it. */
export function setFogProcessedCount(processedCount: number): void {
  if (mapStore.processedCount === processedCount) return
  mapStore.processedCount = processedCount
  for (const listener of fogProgressListeners) listener()
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never

/**
 * Begins a new fog-worker generation, abandoning whatever is in flight.
 *
 * The caller MUST post a RESET immediately after — that is how the worker
 * learns the new id and stops the old loop. Without it the worker keeps running
 * and every reply is dropped, leaving the progress bar stuck.
 *
 * Only call this where the app genuinely discards prior work. Additions normally
 * join the current run; the cache-cold exception deliberately starts over because
 * there is no worker state to preserve.
 */
export function startFogRun(): number {
  mapStore.runId++
  mapStore.isRestoreReprocess = false
  mapStore.fogWorkerMode = null
  return mapStore.runId
}

/** Posts to the fog worker, stamping the current run id. */
export function postToFogWorker(
  msg: DistributiveOmit<WorkerInboundMessage, "runId">
): void {
  if (msg.type === "PROCESS_ACTIVITIES") {
    if (mapStore.fogWorkerMode === null) mapStore.fogWorkerMode = msg.mode
    mapStore.pendingFogJobs++
    mapStore.isFogRunInFlight = true
    for (const activity of msg.activities) {
      mapStore.fogWorkerActivityIds.add(activity.id)
    }

    // ParsedActivity contains timestamps, laps, statistics, and other metadata.
    // Project at the worker boundary so structured cloning only copies what fog
    // processing needs, including when the full library is replayed.
    mapStore.worker?.postMessage({
      ...msg,
      activities: msg.activities.map(({ id, name, coordinates }) => ({
        id,
        name,
        coordinates,
      })),
      runId: mapStore.runId,
    } satisfies WorkerInboundMessage)
    return
  }
  if (msg.type === "RESET") {
    mapStore.pendingFogJobs = 0
    mapStore.isFogRunInFlight = false
    mapStore.fogWorkerActivityIds.clear()
    mapStore.fogWorkerMode = null
  }
  mapStore.worker?.postMessage({ ...msg, runId: mapStore.runId })
}

/** Records one batch completion. Returns true only when the whole run is idle. */
export function finishFogJob(): boolean {
  mapStore.pendingFogJobs = Math.max(0, mapStore.pendingFogJobs - 1)
  mapStore.isFogRunInFlight = mapStore.pendingFogJobs > 0
  return !mapStore.isFogRunInFlight
}

/**
 * Queue an additive fog update. A worker behind a restored render cache has no
 * internal geometry, so its first addition must reset and replay the library.
 */
export function queueAddedActivitiesForFog(
  added: ParsedActivity[],
  mode: FogMode
): void {
  const addedIds = new Set(added.map((activity) => activity.id))
  const missing = mapStore.activities.filter(
    (activity) => !mapStore.fogWorkerActivityIds.has(activity.id)
  )
  if (missing.length === 0) return

  // The worker already contains the previous library and lacks only this
  // addition, so it is safe to extend the current run incrementally. Its
  // accumulator is mode-specific, however: never append corridor work to a
  // fill run (or vice versa).
  const isModeCompatible =
    mapStore.fogWorkerActivityIds.size === 0 || mapStore.fogWorkerMode === mode
  if (
    missing.every((activity) => addedIds.has(activity.id)) &&
    isModeCompatible
  ) {
    postToFogWorker({ type: "PROCESS_ACTIVITIES", activities: missing, mode })
    return
  }

  startFogRun()
  postToFogWorker({ type: "RESET" })
  postToFogWorker({
    type: "PROCESS_ACTIVITIES",
    activities: mapStore.activities,
    mode,
  })
}

/**
 * Add newly-acquired activities to the library: merge, recompute unique distances,
 * hand them to the fog worker, persist, invalidate the fog cache.
 *
 * Both entry points for new activities go through here — the `add-files` action and
 * the sync engine's downloads — so a downloaded activity is indistinguishable from
 * an imported one.
 *
 * Normally it **joins** the current fog run and posts only the additions. The
 * exception is a worker that has only a restored render cache: because that
 * cache cannot hydrate its accumulators, the first addition replays the library.
 */
export async function ingestActivities(
  newActivities: ParsedActivity[]
): Promise<ParsedActivity[]> {
  // Drop anything already held under the same content hash. Re-importing a
  // file, or importing one the server had just restored, must not produce two
  // identical activities — content-addressing is what makes that detectable.
  // Activities with no hash (imported before sync existed) are always kept.
  const present = new Set(
    mapStore.activities.map((t) => t.contentHash).filter(Boolean)
  )
  const added = newActivities.filter((t) => {
    if (!t.contentHash) return true
    if (present.has(t.contentHash)) return false
    present.add(t.contentHash)
    return true
  })

  // Returns what was actually taken, never what was offered. Callers drive the
  // progress UI off this: reporting the offered count when everything was a
  // duplicate leaves "Processing 0 of N…" on screen forever, because no
  // PROCESS_ACTIVITIES was posted and so no DONE ever comes back.
  if (added.length === 0) return added

  setFullActivities(sortActivities([...mapStore.activities, ...added]))
  // A backdated addition can change every later activity's unique distance.
  await ensureUniqueDistancesCurrent(mapStore.activities)
  await clearFogCache()
  // Start processing only after invalidation finishes. A small worker batch can
  // otherwise save its fresh cache first and have this call erase it afterward.
  // Read the mode at queue time. Parsing and IDB writes are asynchronous, and
  // the user may have changed the control since the import was submitted.
  queueAddedActivitiesForFog(added, mapStore.fogMode)
  return added
}

export function worldFogGeoJSON(): GeoJSON.Feature<GeoJSON.Polygon> {
  return worldFogFeature()
}
