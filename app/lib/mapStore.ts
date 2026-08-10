import type maplibregl from "maplibre-gl"
import type { ParsedTrack, FogMode, WorkerInboundMessage } from "~/types/tracks"
import { sortTracks, populateUniqueDistances } from "~/lib/statsAggregator"
import { saveTracks, clearFogCache } from "~/lib/storage"

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

interface MapStore {
  map: maplibregl.Map | null
  worker: Worker | null
  fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  tracks: ParsedTrack[]
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
   * True when tracks were restored but the fog cache was stale, triggering a
   * worker reprocess. MapView skips fitBounds in this case so the saved map
   * position is preserved.
   */
  isRestoreReprocess: boolean
  /**
   * Generation token for fog-worker runs. Bumped by `startFogRun()` wherever
   * the app abandons in-flight work (fog-mode toggle, delete-track, clear-all).
   * Every message to and from the worker carries it.
   */
  runId: number
  /**
   * True between posting PROCESS_TRACKS and the matching DONE.
   *
   * The progress UI cannot just assume work is outstanding after an action:
   * the worker can finish a small batch *before* the action returns, since the
   * action still has IDB writes (and, when signed in, a network round trip) to
   * get through. Setting `isProcessing` unconditionally in that window strands
   * "Processing 0 of N…" forever, because the only thing that clears it — DONE
   * — has already been and gone.
   */
  isFogRunInFlight: boolean
  /**
   * In-memory cache of the last share-card map render. Avoids re-creating a
   * WebGL context on every dialog open. Keyed by trackId. The ImageBitmap is
   * owned by this cache — call .close() before replacing or clearing it.
   */
  shareCardCache: {
    trackId: string
    baseMap: ImageBitmap
    trackPoints: { x: number; y: number }[]
  } | null
}

export const mapStore: MapStore = {
  map: null,
  worker: null,
  fogData: null,
  tracks: [],
  isProcessing: false,
  processedCount: 0,
  sourcesReady: false,
  fogMode: "corridor",
  initialCenter: _savedPosition?.center ?? null,
  initialZoom: _savedPosition?.zoom ?? null,
  isRestoreReprocess: false,
  runId: 0,
  isFogRunInFlight: false,
  shareCardCache: null,
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
 * Only call this where the app genuinely discards prior work. `add-files` posts
 * just the new tracks and relies on the worker's accumulated state, so it must
 * join the current run rather than start one.
 */
export function startFogRun(): number {
  mapStore.runId++
  mapStore.isRestoreReprocess = false
  return mapStore.runId
}

/** Posts to the fog worker, stamping the current run id. */
export function postToFogWorker(
  msg: DistributiveOmit<WorkerInboundMessage, "runId">
): void {
  if (msg.type === "PROCESS_TRACKS") mapStore.isFogRunInFlight = true
  if (msg.type === "RESET") mapStore.isFogRunInFlight = false
  mapStore.worker?.postMessage({ ...msg, runId: mapStore.runId })
}

/**
 * Add newly-acquired tracks to the library: merge, recompute unique distances,
 * hand them to the fog worker, persist, invalidate the fog cache.
 *
 * Both entry points for new tracks go through here — the `add-files` action and
 * the sync engine's downloads — so a downloaded track is indistinguishable from
 * an imported one.
 *
 * Note it **joins** the current fog run rather than calling `startFogRun()`:
 * only the new tracks are posted, and the worker's accumulated fog polygon has
 * to survive for that to be correct.
 */
export async function ingestTracks(
  newTracks: ParsedTrack[],
  mode: FogMode = mapStore.fogMode
): Promise<ParsedTrack[]> {
  // Drop anything already held under the same content hash. Re-importing a
  // file, or importing one the server had just restored, must not produce two
  // identical tracks — content-addressing is what makes that detectable.
  // Tracks with no hash (imported before sync existed) are always kept.
  const present = new Set(
    mapStore.tracks.map((t) => t.contentHash).filter(Boolean)
  )
  const added = newTracks.filter((t) => {
    if (!t.contentHash) return true
    if (present.has(t.contentHash)) return false
    present.add(t.contentHash)
    return true
  })

  // Returns what was actually taken, never what was offered. Callers drive the
  // progress UI off this: reporting the offered count when everything was a
  // duplicate leaves "Processing 0 of N…" on screen forever, because no
  // PROCESS_TRACKS was posted and so no DONE ever comes back.
  if (added.length === 0) return added

  mapStore.tracks = sortTracks([...mapStore.tracks, ...added])
  populateUniqueDistances(mapStore.tracks)
  postToFogWorker({ type: "PROCESS_TRACKS", tracks: added, mode })
  await saveTracks(added)
  await clearFogCache()
  return added
}

export function worldFogGeoJSON(): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-180, -90],
          [180, -90],
          [180, 90],
          [-180, 90],
          [-180, -90],
        ],
      ],
    },
    properties: {},
  }
}
