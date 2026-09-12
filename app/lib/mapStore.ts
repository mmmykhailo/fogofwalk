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
import type { ActivitySummary } from "~/types/activitySummary"
import { activityToSummary } from "~/lib/storage"
import type {
  LibraryMetadataCommit,
  LibrarySummarySnapshot,
} from "~/lib/activities/libraryEvents"

declare global {
  interface Window {
    /** Test-only readiness seam for deterministic map interaction fixtures. */
    __fogofwalkE2eMapStore?: Pick<MapStore, "sourcesReady">
  }
}

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

export interface ActivitySummaryStoreSnapshot {
  hydrated: boolean
  revision: number
  coverageRevision: number
  summaries: readonly ActivitySummary[]
}

const emptyActivitySummarySnapshot: ActivitySummaryStoreSnapshot = {
  hydrated: false,
  revision: 0,
  coverageRevision: 0,
  summaries: Object.freeze([]),
}

let activitySummarySnapshot: ActivitySummaryStoreSnapshot =
  emptyActivitySummarySnapshot
let activityMetadataRevision = 0
const activitySummaryListeners = new Set<() => void>()

interface MapStore {
  map: maplibregl.Map | null
  worker: Worker | null
  fogData: FogRenderData | null
  activities: ParsedActivity[]
  activitySummaries: ActivitySummary[]
  activityHydration: ActivityHydration
  processedCount: number
  sourcesReady: boolean
  /** Current fog mode — kept in sync with React state so MapView can read it without a prop. */
  fogMode: FogMode
  /** Map center restored from localStorage; used once by MapView on initialization. */
  initialCenter: [number, number] | null
  /** Map zoom restored from localStorage; used once by MapView on initialization. */
  initialZoom: number | null
  /** Generation token for fog-worker runs. */
  runId: number
  /** Identity of the latest accepted complete/in-progress fog snapshot. */
  fogSnapshot: {
    generation: number
    libraryRevision: number
    coverageRevision: number
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
  /** Activity membership/geometry revision projected into the fog map. */
  coverageRevision: number
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
    activityPoints: Array<{ x: number; y: number }[]>
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
  coverageRevision: number
  mode: FogMode
  processed: number
  total: number
  error: string | null
  warnings: string[]
  recoveryAttempts: number
  retryable: boolean
  warningCounts: Record<string, number>
  errorCounts: Record<string, number>
  infoCounts: Record<string, number>
  coverageReducedCounts: Record<string, number>
  normalizedActivityCount: number
  coverageReducedActivityCount: number
  /** Compatibility alias for coverageReducedActivityCount. */
  repairedActivityCount: number
  rejectedActivityCount: number
  geometryFallbackCount: number
}

export const mapStore: MapStore = {
  map: null,
  worker: null,
  fogData: null,
  activities: [],
  activitySummaries: [],
  activityHydration: "unloaded",
  processedCount: 0,
  sourcesReady: false,
  fogMode: "corridor",
  initialCenter: _savedPosition?.center ?? null,
  initialZoom: _savedPosition?.zoom ?? null,
  runId: 0,
  fogSnapshot: null,
  renderSourceRevision: null,
  libraryRevision: 0,
  uniqueDistanceProjectionRevision: null,
  coverageRevision: 0,
  isFogWorkerListenerReady: false,
  shareCardCache: null,
}

if (import.meta.env.VITE_E2E === "1" && typeof window !== "undefined") {
  window.__fogofwalkE2eMapStore = mapStore
}

function detachFogWorker(worker: Worker): void {
  worker.onmessage = null
  worker.onerror = null
  worker.onmessageerror = null
  worker.terminate()
}

/** Create the page-owned fog worker with a safe pre-bridge failure handler. */
export function createFogWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Fog workers are unavailable in this environment.")
  }

  const worker = new Worker(
    new URL("../workers/fogWorker.ts", import.meta.url),
    { type: "module" }
  )
  mapStore.worker = worker

  // The loader creates the worker before MapView mounts and can therefore have
  // a short window without the bridge's handlers. Keep recovery safe in that
  // window; the bridge replaces these handlers once it is ready.
  const handleFailure = (reason: unknown) => {
    if (mapStore.worker !== worker) return
    replaceFogWorker(worker)
    fogCoordinator.handleWorkerFailure(reason)
  }
  worker.onerror = (event) => {
    console.error("[worker] uncaught fog worker error", event)
    handleFailure(event.error ?? event.message)
  }
  worker.onmessageerror = () => {
    handleFailure(new Error("Fog worker message could not be decoded."))
  }
  return worker
}

/** Terminate a failed fog worker and install a fresh one for recovery. */
export function replaceFogWorker(
  failedWorker: Worker | null = mapStore.worker
): Worker | null {
  const current = mapStore.worker
  if (failedWorker && failedWorker !== current) {
    detachFogWorker(failedWorker)
    return current
  }

  if (current) {
    detachFogWorker(current)
    mapStore.worker = null
  }

  try {
    return createFogWorker()
  } catch {
    mapStore.worker = null
    return null
  }
}

function freezeActivitySummary(summary: ActivitySummary): ActivitySummary {
  return Object.freeze({
    ...summary,
    stats: Object.freeze({ ...summary.stats }),
  })
}

function sameActivitySummary(
  first: ActivitySummary,
  second: ActivitySummary
): boolean {
  return (
    first.id === second.id &&
    first.name === second.name &&
    first.startedAtMs === second.startedAtMs &&
    first.activityType === second.activityType &&
    first.startSunPhase === second.startSunPhase &&
    first.contentHash === second.contentHash &&
    first.isPublic === second.isPublic &&
    first.stats.distanceKm === second.stats.distanceKm &&
    first.stats.durationMs === second.stats.durationMs &&
    first.stats.elevationGainM === second.stats.elevationGainM &&
    first.stats.avgMovingSpeedKmh === second.stats.avgMovingSpeedKmh
  )
}

function publishActivitySummarySnapshot(
  summaries: readonly ActivitySummary[],
  revision: number,
  coverageRevision: number,
  metadataBatch = false
): void {
  const nextSummaries = Object.freeze(summaries.map(freezeActivitySummary))
  const previous = activitySummarySnapshot
  const unchanged =
    previous.hydrated &&
    previous.revision === revision &&
    previous.coverageRevision === coverageRevision &&
    previous.summaries.length === nextSummaries.length &&
    previous.summaries.every((summary, index) =>
      sameActivitySummary(summary, nextSummaries[index]!)
    )
  if (unchanged) return

  activitySummarySnapshot = {
    hydrated: true,
    revision,
    coverageRevision,
    summaries: nextSummaries,
  }
  if (metadataBatch) activityMetadataRevision++
  for (const listener of activitySummaryListeners) listener()
}

/** Replace the lightweight library used by non-map routes. */
export function setActivitySummaries(summaries: ActivitySummary[]): void {
  if (mapStore.activityHydration === "full") return
  mapStore.activitySummaries = summaries
  mapStore.activityHydration = "summaries"
  publishActivitySummarySnapshot(
    summaries,
    mapStore.libraryRevision,
    mapStore.coverageRevision
  )
}

/** Adopt a summary snapshot that already carries canonical revision metadata. */
export function setActivitySummarySnapshot(
  snapshot: LibrarySummarySnapshot
): void {
  if (mapStore.activityHydration === "full") return
  mapStore.activitySummaries = [...snapshot.summaries]
  mapStore.activityHydration = "summaries"
  mapStore.libraryRevision = snapshot.revision
  mapStore.coverageRevision = snapshot.coverageRevision
  publishActivitySummarySnapshot(
    snapshot.summaries,
    snapshot.revision,
    snapshot.coverageRevision
  )
}

/** Update the summary cache after a metadata-only edit. */
export function updateActivitySummaries(
  updates: readonly ActivitySummary[]
): void {
  if (mapStore.activityHydration !== "summaries") return
  const byId = new Map(updates.map((activity) => [activity.id, activity]))
  const summaries = mapStore.activitySummaries.map(
    (activity) => byId.get(activity.id) ?? activity
  )
  mapStore.activitySummaries = summaries
  publishActivitySummarySnapshot(
    summaries,
    mapStore.libraryRevision,
    mapStore.coverageRevision,
    updates.length > 0
  )
}

/** Apply an authoritative summary-only library event without touching geometry. */
export function applyActivitySummarySnapshot(
  snapshot: LibrarySummarySnapshot,
  commit?: LibraryMetadataCommit
): void {
  mapStore.libraryRevision = snapshot.revision
  mapStore.coverageRevision = snapshot.coverageRevision
  if (mapStore.activityHydration === "full") {
    mapStore.activities = mergeMetadataSnapshot(
      mapStore.activities,
      snapshot.summaries
    )
    publishActivitySummarySnapshot(
      mapStore.activities.map(activityToSummary),
      snapshot.revision,
      snapshot.coverageRevision,
      Boolean(commit?.updated.length)
    )
    return
  }
  mapStore.activitySummaries = [...snapshot.summaries]
  mapStore.activityHydration = "summaries"
  publishActivitySummarySnapshot(
    snapshot.summaries,
    snapshot.revision,
    snapshot.coverageRevision,
    Boolean(commit?.updated.length)
  )
}

/** Merge server metadata into the currently hydrated render cache. */
export function applyActivityMetadata(
  updates: readonly ActivitySummary[]
): void {
  if (mapStore.activityHydration === "full") {
    mapStore.activities = mergeMetadataSnapshot(mapStore.activities, updates)
    publishActivitySummarySnapshot(
      mapStore.activities.map(activityToSummary),
      mapStore.libraryRevision,
      mapStore.coverageRevision,
      updates.length > 0
    )
    return
  }
  updateActivitySummaries(updates)
}

export function getActivitySummarySnapshot(): ActivitySummaryStoreSnapshot {
  return activitySummarySnapshot
}

export function subscribeActivitySummarySnapshot(
  listener: () => void
): () => void {
  activitySummaryListeners.add(listener)
  return () => activitySummaryListeners.delete(listener)
}

export function useActivitySummarySnapshot(): ActivitySummaryStoreSnapshot {
  return useSyncExternalStore(
    subscribeActivitySummarySnapshot,
    getActivitySummarySnapshot,
    getActivitySummarySnapshot
  )
}

export function getActivityMetadataRevision(): number {
  return activityMetadataRevision
}

export function useActivityMetadataRevision(): number {
  return useSyncExternalStore(
    subscribeActivitySummarySnapshot,
    getActivityMetadataRevision,
    getActivityMetadataRevision
  )
}

const fogProgressListeners = new Set<() => void>()
const fogStatusListeners = new Set<() => void>()

let fogStatus: FogProjectionStatus = {
  phase: "idle",
  generation: mapStore.runId,
  libraryRevision: mapStore.libraryRevision,
  coverageRevision: mapStore.coverageRevision,
  mode: mapStore.fogMode,
  processed: 0,
  total: 0,
  error: null,
  warnings: [],
  recoveryAttempts: 0,
  retryable: false,
  warningCounts: {},
  errorCounts: {},
  infoCounts: {},
  coverageReducedCounts: {},
  normalizedActivityCount: 0,
  coverageReducedActivityCount: 0,
  repairedActivityCount: 0,
  rejectedActivityCount: 0,
  geometryFallbackCount: 0,
}

function sameCounts(
  first: Record<string, number>,
  second: Record<string, number>
): boolean {
  const firstEntries = Object.entries(first)
  const secondEntries = Object.entries(second)
  return (
    firstEntries.length === secondEntries.length &&
    firstEntries.every(([key, value]) => second[key] === value)
  )
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
    next.coverageRevision === fogStatus.coverageRevision &&
    next.mode === fogStatus.mode &&
    next.processed === fogStatus.processed &&
    next.total === fogStatus.total &&
    next.error === fogStatus.error &&
    next.recoveryAttempts === fogStatus.recoveryAttempts &&
    sameCounts(next.infoCounts, fogStatus.infoCounts) &&
    sameCounts(next.coverageReducedCounts, fogStatus.coverageReducedCounts) &&
    next.normalizedActivityCount === fogStatus.normalizedActivityCount &&
    next.coverageReducedActivityCount ===
      fogStatus.coverageReducedActivityCount &&
    next.retryable === fogStatus.retryable &&
    next.repairedActivityCount === fogStatus.repairedActivityCount &&
    next.rejectedActivityCount === fogStatus.rejectedActivityCount &&
    next.geometryFallbackCount === fogStatus.geometryFallbackCount &&
    sameCounts(next.warningCounts, fogStatus.warningCounts) &&
    sameCounts(next.errorCounts, fogStatus.errorCounts) &&
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
    warningCounts: { ...next.warningCounts },
    errorCounts: { ...next.errorCounts },
    infoCounts: { ...next.infoCounts },
    coverageReducedCounts: { ...next.coverageReducedCounts },
  }
  for (const listener of fogStatusListeners) listener()
}

/** Canonical activity ownership lives in ActivityLibrary; this is its map projection. */
export const activityLibrary = createActivityLibrary()
let activityLibrarySubscription: (() => void) | null = null
activityLibrary.subscribeMetadata((snapshot, commit) => {
  applyActivitySummarySnapshot(snapshot, commit)
})

/** Revision-keyed derived-stat projection; canonical activity commits do not wait for it. */
export const uniqueDistanceProjection = createUniqueDistanceProjection(
  {},
  {
    onError: ({ coverageRevision, error }) =>
      console.warn(
        `[projection] unique distance failed for coverage revision ${coverageRevision}:`,
        error
      ),
    onComplete: ({ coverageRevision, activities }) => {
      if (mapStore.coverageRevision !== coverageRevision) return
      mapStore.activities = mergeUniqueDistanceStats(
        mapStore.activities,
        activities
      )
      mapStore.uniqueDistanceProjectionRevision = coverageRevision
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
        coverageRevision: request.coverageRevision,
        mode: request.mode,
        processed: 0,
        total: request.activities.length,
        error: null,
        warnings: [],
        retryable: false,
        warningCounts: {},
        errorCounts: {},
        infoCounts: {},
        coverageReducedCounts: {},
        normalizedActivityCount: 0,
        coverageReducedActivityCount: 0,
        repairedActivityCount: 0,
        rejectedActivityCount: 0,
        geometryFallbackCount: 0,
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
        coverageRevision: context.request.coverageRevision,
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
        retryability:
          error.kind === "worker"
            ? "retryable"
            : error.kind === "protocol"
              ? "permanent"
              : "permanent",
      })
      updateFogStatus((current) => ({
        ...current,
        phase:
          error.kind === "worker" || error.kind === "engine"
            ? "failed"
            : "degraded",
        error: error.message,
        retryable: error.kind === "worker",
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
        coverageRevision: context.request.coverageRevision,
        mode: context.request.mode,
        processed: 0,
        total: context.request.activities.length,
        recoveryAttempts: 1,
        retryable: true,
      })
    },
    onTerminal: (terminal) => {
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
        result: terminal.status === "complete" ? "success" : terminal.status,
        ...(terminal.status === "failed"
          ? { errorCode: "fog-processing-failed", retryability: "retryable" }
          : {}),
        ...(terminal.snapshot
          ? {
              warningCounts: terminal.snapshot.diagnostics.warningCounts,
              errorCounts: terminal.snapshot.diagnostics.errorCounts,
              infoCounts: terminal.snapshot.diagnostics.infoCounts,
              coverageReducedCounts:
                terminal.snapshot.diagnostics.coverageReducedCounts,
              normalizedActivityCount:
                terminal.snapshot.diagnostics.normalizedActivityCount,
              coverageReducedActivityCount:
                terminal.snapshot.diagnostics.coverageReducedActivityCount,
              repairedActivityCount:
                terminal.snapshot.diagnostics.repairedActivityCount,
              rejectedActivityCount:
                terminal.snapshot.diagnostics.rejectedActivityCount,
              geometryFallbackCount:
                terminal.snapshot.diagnostics.geometryFallbackCount,
            }
          : {}),
      })
      if (terminal.status === "failed") {
        updateFogStatus({
          phase: "failed",
          error: terminal.error ?? "Fog processing failed.",
          retryable: true,
        })
      } else if (terminal.status === "partial" && terminal.snapshot) {
        const diagnostics = terminal.snapshot.diagnostics
        updateFogStatus({
          phase: "degraded",
          error:
            diagnostics.errors[0] ??
            "Fog completed with reduced coverage; your activities are safe.",
          warnings: [...diagnostics.warnings, ...diagnostics.errors],
          retryable: false,
          warningCounts: { ...(diagnostics.warningCounts ?? {}) },
          errorCounts: { ...(diagnostics.errorCounts ?? {}) },
          infoCounts: { ...(diagnostics.infoCounts ?? {}) },
          coverageReducedCounts: {
            ...(diagnostics.coverageReducedCounts ?? {}),
          },
          normalizedActivityCount: diagnostics.normalizedActivityCount ?? 0,
          coverageReducedActivityCount:
            diagnostics.coverageReducedActivityCount ?? 0,
          repairedActivityCount: diagnostics.repairedActivityCount ?? 0,
          rejectedActivityCount: diagnostics.rejectedActivityCount ?? 0,
          geometryFallbackCount: diagnostics.geometryFallbackCount ?? 0,
        })
      } else if (
        terminal.status === "cancelled" &&
        !fogCoordinator.activeRequest &&
        !fogCoordinator.queuedSnapshot
      ) {
        updateFogStatus({
          phase: "idle",
          processed: 0,
          total: 0,
          error: null,
          warnings: [],
          retryable: false,
          warningCounts: {},
          errorCounts: {},
          infoCounts: {},
          coverageReducedCounts: {},
          normalizedActivityCount: 0,
          coverageReducedActivityCount: 0,
          repairedActivityCount: 0,
          rejectedActivityCount: 0,
          geometryFallbackCount: 0,
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

function mergeMetadataSnapshot(
  currentActivities: readonly ParsedActivity[],
  snapshotActivities: ReadonlyArray<
    Pick<
      ParsedActivity,
      | "id"
      | "name"
      | "startedAtMs"
      | "activityType"
      | "startSunPhase"
      | "contentHash"
      | "isPublic"
    >
  >
): ParsedActivity[] {
  const nextById = new Map(
    snapshotActivities.map((activity) => [activity.id, activity])
  )
  return currentActivities.map((activity) => {
    const next = nextById.get(activity.id)
    if (!next) return activity
    if (
      activity.name === next.name &&
      activity.startedAtMs === next.startedAtMs &&
      activity.activityType === next.activityType &&
      activity.startSunPhase === next.startSunPhase &&
      activity.contentHash === next.contentHash &&
      activity.isPublic === next.isPublic
    ) {
      return activity
    }
    return {
      ...activity,
      name: next.name,
      startedAtMs: next.startedAtMs,
      activityType: next.activityType,
      startSunPhase: next.startSunPhase,
      contentHash: next.contentHash,
      isPublic: next.isPublic,
    }
  })
}

/** Merge only derived unique-distance values into the latest activity projection. */
export function mergeUniqueDistanceStats(
  currentActivities: readonly ParsedActivity[],
  projectedActivities: readonly ParsedActivity[]
): ParsedActivity[] {
  const projectedById = new Map(
    projectedActivities.map((activity) => [activity.id, activity])
  )
  return currentActivities.map((activity) => {
    const projected = projectedById.get(activity.id)
    if (
      !projected ||
      projected.stats.uniqueDistanceKm === activity.stats.uniqueDistanceKm
    ) {
      return activity
    }
    return {
      ...activity,
      stats: {
        ...activity.stats,
        uniqueDistanceKm: projected.stats.uniqueDistanceKm,
      },
    }
  })
}

function applyLibrarySnapshot(
  snapshot: LibrarySnapshot,
  change?: LibraryChange
): void {
  const wasFullyHydrated = mapStore.activityHydration === "full"
  const coverageChanged =
    mapStore.coverageRevision !== snapshot.coverageRevision
  if (
    mapStore.activityHydration !== "full" ||
    coverageChanged ||
    change?.domains.geometry ||
    change?.domains.membership
  ) {
    mapStore.activities = cloneActivities(snapshot.activities)
    mapStore.uniqueDistanceProjectionRevision = null
  } else if (change?.domains.metadata) {
    mapStore.activities = mergeMetadataSnapshot(
      mapStore.activities,
      snapshot.activities
    )
  } else if (change?.domains.statistics) {
    const statsById = new Map(
      snapshot.activities.map((activity) => [activity.id, activity.stats])
    )
    mapStore.activities = mapStore.activities.map((activity) => {
      const stats = statsById.get(activity.id)
      return stats ? { ...activity, stats } : activity
    })
  }
  mapStore.activitySummaries = []
  mapStore.activityHydration = "full"
  mapStore.libraryRevision = snapshot.revision
  mapStore.coverageRevision = snapshot.coverageRevision
  publishActivitySummarySnapshot(
    mapStore.activities.map(activityToSummary),
    snapshot.revision,
    snapshot.coverageRevision,
    Boolean(change?.domains.metadata && change.updated.length > 0)
  )
  const coverageDomainChanged = Boolean(
    change?.domains.membership || change?.domains.geometry
  )
  if (!wasFullyHydrated || coverageChanged || coverageDomainChanged) {
    uniqueDistanceProjection.schedule(snapshot)
  }
}

function applyFogLibraryChange(
  snapshot: LibrarySnapshot,
  change: LibraryChange
): void {
  if (
    change.domains.statistics &&
    !change.domains.membership &&
    !change.domains.geometry
  ) {
    return
  }
  if (!change.domains.membership && !change.domains.geometry) return
  if (!mapStore.worker) {
    if (change.updated.length > 0 || change.removed.length > 0) {
      rebuildFogProjection(mapStore.fogMode)
    } else {
      updateFogStatus({
        phase: "failed",
        generation: mapStore.runId,
        libraryRevision: snapshot.revision,
        coverageRevision: snapshot.coverageRevision,
        mode: mapStore.fogMode,
        total: snapshot.activities.length,
        error: "Fog processing is unavailable. Retry to clear the new route.",
        retryable: true,
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
    coverageRevision: snapshot.coverageRevision,
  })
}

/** Load and bind the canonical activity library to the map render projection. */
export async function initializeActivityLibrary(): Promise<ParsedActivity[]> {
  if (!activityLibrarySubscription) {
    activityLibrarySubscription = activityLibrary.subscribe(
      (snapshot, change) => {
        applyLibrarySnapshot(snapshot, change)
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

export function recordFogSnapshot(
  snapshot: FogSnapshot,
  terminal = true
): void {
  if (
    snapshot.generation !== mapStore.runId ||
    snapshot.coverageRevision !== mapStore.coverageRevision ||
    snapshot.mode !== mapStore.fogMode
  ) {
    return
  }
  setFogProcessedCount(snapshot.diagnostics.processed)
  const diagnostics = snapshot.diagnostics
  const coverageReducedActivityCount =
    diagnostics.coverageReducedActivityCount ??
    diagnostics.repairedActivityCount ??
    0
  const isCompleteSnapshot =
    snapshot.completeness === "complete" &&
    !diagnostics.degraded &&
    coverageReducedActivityCount === 0 &&
    (diagnostics.rejectedActivityCount ?? 0) === 0 &&
    (diagnostics.geometryFallbackCount ?? 0) === 0 &&
    diagnostics.errors.length === 0
  updateFogStatus({
    phase: !terminal ? "processing" : isCompleteSnapshot ? "idle" : "degraded",
    generation: snapshot.generation,
    libraryRevision: snapshot.libraryRevision,
    coverageRevision: snapshot.coverageRevision,
    mode: snapshot.mode,
    processed: snapshot.diagnostics.processed,
    total: snapshot.diagnostics.total,
    error: terminal
      ? (diagnostics.errors[0] ??
        (diagnostics.degraded
          ? "Fog was rebuilt with reduced coverage."
          : null))
      : null,
    warnings: [...diagnostics.warnings, ...diagnostics.errors],
    recoveryAttempts: 0,
    retryable: false,
    warningCounts: { ...(diagnostics.warningCounts ?? {}) },
    errorCounts: { ...(diagnostics.errorCounts ?? {}) },
    infoCounts: { ...(diagnostics.infoCounts ?? {}) },
    coverageReducedCounts: { ...(diagnostics.coverageReducedCounts ?? {}) },
    normalizedActivityCount: diagnostics.normalizedActivityCount ?? 0,
    coverageReducedActivityCount,
    repairedActivityCount: coverageReducedActivityCount,
    rejectedActivityCount: diagnostics.rejectedActivityCount ?? 0,
    geometryFallbackCount: diagnostics.geometryFallbackCount ?? 0,
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
 * join the current run; the coordinator rebuilds from the canonical projection
 * when a restored worker has no completed base.
 */
export function startFogRun(): number {
  mapStore.runId++
  mapStore.fogSnapshot = null
  mapStore.renderSourceRevision = null
  updateFogStatus({
    phase: "processing",
    generation: mapStore.runId,
    libraryRevision: mapStore.libraryRevision,
    coverageRevision: mapStore.coverageRevision,
    mode: mapStore.fogMode,
    processed: 0,
    total: mapStore.activities.length,
    error: null,
    warnings: [],
    recoveryAttempts: 0,
    retryable: false,
    warningCounts: {},
    errorCounts: {},
    infoCounts: {},
    coverageReducedCounts: {},
    normalizedActivityCount: 0,
    coverageReducedActivityCount: 0,
    repairedActivityCount: 0,
    rejectedActivityCount: 0,
    geometryFallbackCount: 0,
  })
  return mapStore.runId
}

/** Posts a versioned request to the fog worker, stamping the current run id. */
export function postToFogWorker(msg: FogWorkerCommand): boolean {
  if (msg.type === "PROCESS_ACTIVITIES") {
    const worker = mapStore.worker
    if (!worker) return false

    const libraryRevision = msg.libraryRevision ?? mapStore.libraryRevision
    const coverageRevision = msg.coverageRevision ?? mapStore.coverageRevision
    const completed = fogCoordinator.completedSnapshot
    const hasCompatibleBase =
      completed !== null &&
      completed.generation === mapStore.runId &&
      completed.mode === msg.mode &&
      completed.coverageRevision < coverageRevision
    const kind = msg.kind ?? (hasCompatibleBase ? "append" : "rebuild")
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
          coverageRevision,
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
    mapStore.fogSnapshot = null
  }
  if (!mapStore.worker) return false
  try {
    fogCoordinator.reset({
      generation: mapStore.runId,
      libraryRevision: mapStore.libraryRevision,
      coverageRevision: mapStore.coverageRevision,
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
      coverageRevision: mapStore.coverageRevision,
      mode,
      error: "Fog processing is unavailable. Retry to rebuild the map.",
      retryable: true,
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
      retryable: false,
      warningCounts: {},
      errorCounts: {},
      infoCounts: {},
      coverageReducedCounts: {},
      normalizedActivityCount: 0,
      coverageReducedActivityCount: 0,
      repairedActivityCount: 0,
      rejectedActivityCount: 0,
      geometryFallbackCount: 0,
    })
    return true
  }
  const scheduled = postToFogWorker({
    type: "PROCESS_ACTIVITIES",
    activities: mapStore.activities,
    mode,
    kind: "rebuild",
    libraryRevision: mapStore.libraryRevision,
    coverageRevision: mapStore.coverageRevision,
  })
  if (!scheduled) {
    updateFogStatus({
      phase: "failed",
      error: "Fog processing could not be scheduled. Retry to rebuild the map.",
      retryable: true,
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

/**
 * Queue an additive fog update. A worker behind a restored render cache has no
 * internal geometry, so its first addition must reset and replay the library.
 */
export function queueAddedActivitiesForFog(
  added: ParsedActivity[],
  mode: FogMode
): void {
  if (added.length === 0) return
  postToFogWorker({
    type: "PROCESS_ACTIVITIES",
    activities: added,
    mode,
    kind: "append",
    libraryRevision: mapStore.libraryRevision,
    coverageRevision: mapStore.coverageRevision,
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
        ? (commit) =>
            commit.change.added.flatMap((activity) => {
              const item = createActivityUploadOutboxItem(
                activity,
                operationId,
                commit.snapshot.revision
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
