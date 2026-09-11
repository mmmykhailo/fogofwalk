import type maplibregl from "maplibre-gl"
import { useSyncExternalStore } from "react"
import type {
  ParsedActivity,
  FogMode,
  FogWorkerCommand,
  FogWorkerActivity,
} from "~/types/activities"
import { sortActivities } from "~/lib/statsAggregator"
import { emptyBoundedFog } from "~/lib/fog/engine/aggregate"
import type { FogRenderData } from "~/lib/fog/protocol"
import { createFogCoordinator } from "~/lib/fog/coordinator"
import { pathsForActivity } from "~shared/activityContract"
import { createActivityLibrary } from "~/lib/activities/library"
import type {
  LibraryChange,
  LibrarySnapshot,
} from "~/lib/activities/libraryEvents"
import { createUuid } from "~/lib/uuid"
import { isServerEnabled } from "~/lib/server/config"
import { createActivityUploadOutboxItem } from "~/lib/server/sync/activityEffects"
import { createUniqueDistanceProjection } from "~/lib/uniqueDistanceProjection"
import type { FogSnapshot } from "~/lib/fog/protocol"
import { recordDiagnostic } from "~/lib/diagnostics"

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
  fogData: FogRenderData | null
  activities: ParsedActivity[]
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
  /** Library revision represented by the worker's incremental accumulator. */
  fogWorkerLibraryRevision: number
  /** Identity of the latest accepted complete/in-progress fog snapshot. */
  fogSnapshot: {
    generation: number
    libraryRevision: number
    mode: FogMode
    algorithmVersion: number
    partitionSchemeVersion: number
  } | null
  /** Library revision most recently delivered to the active fog map source. */
  renderSourceRevision: number | null
  /** Revision of the canonical activity snapshot projected into this store. */
  libraryRevision: number
  /** Revision for which unique-distance values have been applied to this projection. */
  uniqueDistanceProjectionRevision: number | null
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

export type FogProjectionPhase =
  | "idle"
  | "processing"
  | "recovering"
  | "degraded"
  | "failed"

export interface FogProjectionStatus {
  phase: FogProjectionPhase
  generation: number
  libraryRevision: number
  mode: FogMode
  processed: number
  total: number
  error: string | null
  warnings: string[]
  recoveryAttempts: number
}

export const mapStore: MapStore = {
  map: null,
  worker: null,
  fogData: null,
  activities: [],
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
  fogWorkerLibraryRevision: 0,
  fogSnapshot: null,
  renderSourceRevision: null,
  libraryRevision: 0,
  uniqueDistanceProjectionRevision: null,
  isFogWorkerListenerReady: false,
  shareCardCache: null,
}

const fogProgressListeners = new Set<() => void>()
const fogStatusListeners = new Set<() => void>()

let fogStatus: FogProjectionStatus = {
  phase: "idle",
  generation: mapStore.runId,
  libraryRevision: mapStore.libraryRevision,
  mode: mapStore.fogMode,
  processed: 0,
  total: 0,
  error: null,
  warnings: [],
  recoveryAttempts: 0,
}

function updateFogStatus(
  update:
    | Partial<FogProjectionStatus>
    | ((current: FogProjectionStatus) => FogProjectionStatus)
): void {
  const next =
    typeof update === "function"
      ? update(fogStatus)
      : { ...fogStatus, ...update }
  if (
    next.phase === fogStatus.phase &&
    next.generation === fogStatus.generation &&
    next.libraryRevision === fogStatus.libraryRevision &&
    next.mode === fogStatus.mode &&
    next.processed === fogStatus.processed &&
    next.total === fogStatus.total &&
    next.error === fogStatus.error &&
    next.recoveryAttempts === fogStatus.recoveryAttempts &&
    next.warnings.length === fogStatus.warnings.length &&
    next.warnings.every(
      (warning, index) => warning === fogStatus.warnings[index]
    )
  ) {
    return
  }
  fogStatus = {
    ...next,
    warnings: [...next.warnings],
  }
  for (const listener of fogStatusListeners) listener()
}

/** Canonical activity ownership lives in ActivityLibrary; this is its map projection. */
export const activityLibrary = createActivityLibrary()
let activityLibrarySubscription: (() => void) | null = null

/** Revision-keyed derived-stat projection; canonical activity commits do not wait for it. */
export const uniqueDistanceProjection = createUniqueDistanceProjection(
  {},
  {
    onError: ({ revision, error }) =>
      console.warn(
        `[projection] unique distance failed for library revision ${revision}:`,
        error
      ),
    onComplete: ({ revision, activities }) => {
      if (mapStore.libraryRevision === revision) {
        mapStore.activities = cloneActivities(activities)
        mapStore.uniqueDistanceProjectionRevision = revision
      }
    },
  }
)

/** Revision-aware owner of fog requests; mapStore keeps only its UI projection. */
export const fogCoordinator = createFogCoordinator(
  {
    send: (request) => {
      if (!mapStore.worker) throw new Error("Fog worker is unavailable")
      mapStore.worker.postMessage(request)
    },
  },
  {
    onRequest: ({ request }) => {
      if (request.kind === "rebuild") mapStore.fogWorkerActivityIds.clear()
      for (const activity of request.activities)
        mapStore.fogWorkerActivityIds.add(activity.id)
      mapStore.fogWorkerMode = request.mode
      mapStore.fogWorkerLibraryRevision = request.libraryRevision
      mapStore.pendingFogJobs++
      mapStore.isFogRunInFlight = true
      recordDiagnostic({
        subsystem: "fog",
        operationId: request.requestId,
        libraryRevision: request.libraryRevision,
        stage: request.kind,
        itemCount: request.activities.length,
        pointCount: workerPointCount(request.activities),
        result: "started",
      })
      updateFogStatus({
        phase: "processing",
        generation: request.generation,
        libraryRevision: request.libraryRevision,
        mode: request.mode,
        processed: 0,
        total: request.activities.length,
        error: null,
        warnings: [],
      })
    },
    onProgress: (progress, context) => {
      setFogProcessedCount(progress.processed)
      recordDiagnostic({
        subsystem: "fog",
        operationId: context.request.requestId,
        libraryRevision: context.request.libraryRevision,
        stage: progress.stage,
        itemCount: progress.total,
        result: "progress",
      })
      updateFogStatus({
        phase: fogStatus.phase === "degraded" ? "degraded" : "processing",
        generation: context.request.generation,
        libraryRevision: context.request.libraryRevision,
        mode: context.request.mode,
        processed: progress.processed,
        total: progress.total,
      })
    },
    onError: (error) => {
      recordDiagnostic({
        subsystem: "fog",
        operationId: error.context?.request.requestId,
        libraryRevision: error.context?.request.libraryRevision,
        stage: "error",
        itemCount: error.context?.request.activities.length,
        result: error.kind === "protocol" ? "degraded" : "failed",
        errorCode:
          error.kind === "worker"
            ? "worker-failed"
            : error.kind === "engine"
              ? "engine-failed"
              : "protocol-error",
        retryability: error.kind === "protocol" ? "permanent" : "retryable",
      })
      updateFogStatus((current) => ({
        ...current,
        phase:
          error.kind === "worker" || error.kind === "engine"
            ? "failed"
            : "degraded",
        error: error.message,
      }))
    },
    onRecovery: (context) => {
      recordDiagnostic({
        subsystem: "fog",
        operationId: context.request.requestId,
        libraryRevision: context.request.libraryRevision,
        stage: "recovery",
        itemCount: context.request.activities.length,
        result: "started",
        retryability: "retryable",
      })
      updateFogStatus({
        phase: "recovering",
        generation: context.request.generation,
        libraryRevision: context.request.libraryRevision,
        mode: context.request.mode,
        processed: 0,
        total: context.request.activities.length,
        recoveryAttempts: 1,
      })
    },
    onTerminal: (terminal) => {
      finishFogJob()
      mapStore.isRestoreReprocess = false
      recordDiagnostic({
        subsystem: "fog",
        operationId: terminal.context.request.requestId,
        libraryRevision: terminal.context.request.libraryRevision,
        stage: "complete",
        itemCount: terminal.context.request.activities.length,
        ...(terminal.snapshot
          ? {
              pointCount: terminal.snapshot.diagnostics.outputPoints,
              geometry: snapshotGeometryMetrics(terminal.snapshot),
            }
          : {}),
        result:
          terminal.status === "complete"
            ? terminal.snapshot?.completeness === "complete"
              ? "success"
              : "degraded"
            : terminal.status,
        ...(terminal.status === "failed"
          ? { errorCode: "fog-processing-failed", retryability: "retryable" }
          : {}),
      })
      if (terminal.status === "failed") {
        updateFogStatus({
          phase: "failed",
          error: terminal.error ?? "Fog processing failed.",
        })
      } else if (
        terminal.status === "cancelled" &&
        !fogCoordinator.activeRequest
      ) {
        updateFogStatus({
          phase: "idle",
          processed: 0,
          total: 0,
          error: null,
          warnings: [],
        })
      }
    },
  }
)

function cloneActivities(
  activities: readonly ParsedActivity[]
): ParsedActivity[] {
  const copy =
    typeof structuredClone === "function"
      ? structuredClone([...activities])
      : JSON.parse(JSON.stringify(activities))
  return sortActivities(copy as ParsedActivity[])
}

function workerPointCount(activities: readonly FogWorkerActivity[]): number {
  return activities.reduce(
    (count, activity) =>
      count +
      (activity.paths
        ? activity.paths.reduce((pathCount, path) => pathCount + path.length, 0)
        : activity.coordinates.length),
    0
  )
}

function snapshotGeometryMetrics(snapshot: FogSnapshot) {
  return {
    inputPoints: snapshot.diagnostics.inputPoints,
    outputPoints: snapshot.diagnostics.outputPoints,
    featureCount: snapshot.diagnostics.featureCount,
    vertexCount: snapshot.diagnostics.vertexCount,
  }
}

function toFogWorkerActivity(activity: FogWorkerActivity): FogWorkerActivity {
  return {
    id: activity.id,
    name: activity.name,
    coordinates: activity.coordinates,
    ...(activity.paths ? { paths: pathsForActivity(activity) } : {}),
  }
}

function applyLibrarySnapshot(snapshot: LibrarySnapshot): void {
  if (mapStore.uniqueDistanceProjectionRevision !== snapshot.revision) {
    mapStore.activities = cloneActivities(snapshot.activities)
    mapStore.uniqueDistanceProjectionRevision = null
  }
  mapStore.libraryRevision = snapshot.revision
  uniqueDistanceProjection.schedule(snapshot)
}

function applyFogLibraryChange(
  snapshot: LibrarySnapshot,
  change: LibraryChange
): void {
  const hasChanges =
    change.added.length > 0 ||
    change.updated.length > 0 ||
    change.removed.length > 0
  if (!hasChanges) return
  if (!mapStore.worker) {
    if (change.updated.length > 0 || change.removed.length > 0) {
      rebuildFogProjection(mapStore.fogMode)
    } else {
      updateFogStatus({
        phase: "failed",
        generation: mapStore.runId,
        libraryRevision: snapshot.revision,
        mode: mapStore.fogMode,
        total: snapshot.activities.length,
        error: "Fog processing is unavailable. Retry to clear the new route.",
      })
    }
    return
  }

  setFogProcessedCount(0)
  if (change.updated.length > 0 || change.removed.length > 0) {
    // A removal or revisioned update invalidates the worker accumulator. The
    // coordinator owns the reset/rebuild identity; this projection only
    // clears the render-side snapshot before the replacement arrives.
    rebuildFogProjection(mapStore.fogMode)
    return
  }

  // Additions can extend the exact completed base. FogCoordinator falls back
  // to a full rebuild when the restored worker has no durable base state.
  postToFogWorker({
    type: "PROCESS_ACTIVITIES",
    activities: change.added,
    mode: mapStore.fogMode,
    kind: "append",
    libraryRevision: snapshot.revision,
  })
}

/** Load and bind the canonical activity library to the map render projection. */
export async function initializeActivityLibrary(): Promise<ParsedActivity[]> {
  if (!activityLibrarySubscription) {
    activityLibrarySubscription = activityLibrary.subscribe(
      (snapshot, change) => {
        applyLibrarySnapshot(snapshot)
        applyFogLibraryChange(snapshot, change)
      }
    )
  }
  const snapshot = await activityLibrary.initialize()
  applyLibrarySnapshot(snapshot)
  return cloneActivities(snapshot.activities)
}

/** Apply a canonical snapshot from another route/service to the render store. */
export function setActivityProjection(snapshot: LibrarySnapshot): void {
  applyLibrarySnapshot(snapshot)
}

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

export function subscribeFogStatus(listener: () => void): () => void {
  fogStatusListeners.add(listener)
  return () => fogStatusListeners.delete(listener)
}

export function getFogStatus(): FogProjectionStatus {
  return fogStatus
}

export function recordFogSnapshot(snapshot: FogSnapshot): void {
  if (
    snapshot.generation !== mapStore.runId ||
    snapshot.libraryRevision !== mapStore.libraryRevision ||
    snapshot.mode !== mapStore.fogMode
  ) {
    return
  }
  setFogProcessedCount(snapshot.diagnostics.processed)
  updateFogStatus({
    phase:
      snapshot.completeness === "complete" && !snapshot.diagnostics.degraded
        ? "idle"
        : "degraded",
    generation: snapshot.generation,
    libraryRevision: snapshot.libraryRevision,
    mode: snapshot.mode,
    processed: snapshot.diagnostics.processed,
    total: snapshot.diagnostics.total,
    error:
      snapshot.diagnostics.errors[0] ??
      (snapshot.diagnostics.degraded
        ? "Fog was rebuilt with reduced coverage."
        : null),
    warnings: [
      ...snapshot.diagnostics.warnings,
      ...snapshot.diagnostics.errors,
    ],
    recoveryAttempts: 0,
  })
}

export function useFogStatus(): FogProjectionStatus {
  // Kept here rather than in a component module so all map surfaces consume
  // the same revisioned projection state.
  return useSyncExternalStore(subscribeFogStatus, getFogStatus, getFogStatus)
}

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
  mapStore.fogWorkerLibraryRevision = 0
  mapStore.fogSnapshot = null
  mapStore.renderSourceRevision = null
  updateFogStatus({
    phase: "processing",
    generation: mapStore.runId,
    libraryRevision: mapStore.libraryRevision,
    mode: mapStore.fogMode,
    processed: 0,
    total: mapStore.activities.length,
    error: null,
    warnings: [],
    recoveryAttempts: 0,
  })
  return mapStore.runId
}

/** Posts a versioned request to the fog worker, stamping the current run id. */
export function postToFogWorker(msg: FogWorkerCommand): boolean {
  if (msg.type === "PROCESS_ACTIVITIES") {
    const worker = mapStore.worker
    if (!worker) return false

    const kind =
      msg.kind ??
      (mapStore.fogWorkerActivityIds.size > 0 &&
      mapStore.fogWorkerMode === msg.mode
        ? "append"
        : "rebuild")
    const libraryRevision = msg.libraryRevision ?? mapStore.libraryRevision
    // ParsedActivity contains timestamps, laps, statistics, and other metadata.
    // Project at the worker boundary so structured cloning only copies what fog
    // processing needs, including when the full library is replayed.
    const activities = msg.activities.map(toFogWorkerActivity)
    const allActivities = mapStore.activities.map(toFogWorkerActivity)
    try {
      const context = fogCoordinator.schedule(
        {
          generation: mapStore.runId,
          libraryRevision,
          mode: msg.mode,
          activities: allActivities,
        },
        {
          appendActivities: kind === "append" ? activities : [],
          forceRebuild: kind === "rebuild",
        }
      )
      if (!context && !fogCoordinator.queuedSnapshot) return false
      return true
    } catch {
      return false
    }
  }
  if (msg.type === "RESET") {
    mapStore.pendingFogJobs = 0
    mapStore.isFogRunInFlight = false
    mapStore.fogWorkerActivityIds.clear()
    mapStore.fogWorkerMode = null
    mapStore.fogWorkerLibraryRevision = 0
    mapStore.fogSnapshot = null
  }
  if (!mapStore.worker) return false
  try {
    fogCoordinator.reset({
      generation: mapStore.runId,
      libraryRevision: mapStore.libraryRevision,
      mode: mapStore.fogMode,
    })
    return true
  } catch {
    return false
  }
}

/** Start a complete fog projection for the current committed library revision. */
export function rebuildFogProjection(
  mode: FogMode = mapStore.fogMode
): boolean {
  mapStore.fogMode = mode
  mapStore.fogData = null
  const generation = startFogRun()
  const resetPosted = postToFogWorker({ type: "RESET" })
  if (!resetPosted) {
    updateFogStatus({
      phase: "failed",
      generation,
      libraryRevision: mapStore.libraryRevision,
      mode,
      error: "Fog processing is unavailable. Retry to rebuild the map.",
    })
    return false
  }
  if (mapStore.activities.length === 0) {
    updateFogStatus({
      phase: "idle",
      processed: 0,
      total: 0,
      error: null,
      warnings: [],
    })
    return true
  }
  const scheduled = postToFogWorker({
    type: "PROCESS_ACTIVITIES",
    activities: mapStore.activities,
    mode,
    kind: "rebuild",
    libraryRevision: mapStore.libraryRevision,
  })
  if (!scheduled) {
    updateFogStatus({
      phase: "failed",
      error: "Fog processing could not be scheduled. Retry to rebuild the map.",
    })
  }
  return scheduled
}

/** Abandon the current fog run and clear its render projection. */
export function clearFogProjection(): void {
  mapStore.fogData = null
  setFogProcessedCount(0)
  const generation = startFogRun()
  if (!postToFogWorker({ type: "RESET" })) {
    updateFogStatus({
      phase: mapStore.activities.length === 0 ? "idle" : "failed",
      generation,
      processed: 0,
      total: mapStore.activities.length,
      error:
        mapStore.activities.length === 0
          ? null
          : "Fog processing is unavailable. Retry to rebuild the map.",
    })
  }
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
 * Add newly-acquired activities to the canonical library.
 *
 * The library subscription owns both derived projections, so imported and
 * downloaded activities follow the same fog and unique-distance path after the
 * durable commit returns.
 */
export async function ingestActivities(
  newActivities: ParsedActivity[]
): Promise<ParsedActivity[]> {
  await initializeActivityLibrary()
  const operationId = createUuid()
  const result = await activityLibrary.dispatch(
    {
      type: "import",
      operationId,
      activities: newActivities,
    },
    {
      outbox: isServerEnabled
        ? newActivities.flatMap((activity) => {
            const item = createActivityUploadOutboxItem(
              activity,
              operationId,
              activityLibrary.getSnapshot().revision
            )
            return item ? [item] : []
          })
        : [],
    }
  )
  const added = result.change.added
  if (added.length === 0) return added

  // The canonical commit has completed. Fog starts immediately and derived
  // work/cache invalidation are independent projections of that revision.
  return added
}

export function worldFogGeoJSON(): FogRenderData {
  return emptyBoundedFog().fogData
}
