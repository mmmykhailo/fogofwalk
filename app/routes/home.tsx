import { useState, useEffect, useMemo, useRef } from "react"
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
  useRevalidator,
  useSearchParams,
} from "react-router"
import bbox from "@turf/bbox"
import type { Route } from "./+types/home"
import { MapView } from "~/components/map/MapView"
import { ControlPanel } from "~/components/ControlPanel"
import { FileUploadDialog } from "~/components/FileUploadDialog"
import { PhotoErrorDialog } from "~/components/PhotoErrorDialog"
import { ParseErrorDialog } from "~/components/ParseErrorDialog"
import { DuplicateActivitiesDialog } from "~/components/DuplicateActivitiesDialog"
import { MissingActivityTypeDialog } from "~/components/MissingActivityTypeDialog"
import { DraggableActivityDialog } from "~/components/activity-stats/DraggableActivityDialog"
import { ShareDialog } from "~/components/ShareDialog"
import { DraggablePhotoDialog } from "~/components/DraggablePhotoDialog"
import { DraggableSavedPointEditDialog } from "~/components/DraggableSavedPointEditDialog"
import { DraggableSavedPointViewDialog } from "~/components/DraggableSavedPointViewDialog"
import { ErrorBoundary } from "~/components/ErrorBoundary"
import { ErrorCard } from "~/components/ErrorCard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import {
  fogCoordinator,
  mapStore,
  activityLibrary,
  initializeActivityLibrary,
  rebuildFogProjection,
  useFogStatus,
} from "~/lib/mapStore"
import { createActivityImportService } from "~/lib/activities/import/service"
import type { LibraryCommit } from "~/lib/activities/libraryEvents"
import {
  beginImport,
  completeImport,
  failImport,
  reportImportProgress,
} from "~/lib/activities/import/status"
import type { ImportFailureSummary } from "~/lib/activities/import/service"
import { createUuid } from "~/lib/uuid"
import { recordDiagnostic } from "~/lib/diagnostics"
import { createActivityUploadOutboxItem } from "~/lib/server/sync/activityEffects"
import { createActivityDeleteOutboxItem } from "~/lib/server/sync/activityEffects"
import { buildLapActivity, lapSubtitle } from "~/lib/laps"
import { processPhotoFiles } from "~/lib/photos"
import {
  savePhotos,
  loadPhotos,
  saveFogMode,
  loadFogMode,
  loadFogCache,
  clearAll,
  loadSavedPoints,
  saveSavedPoint,
  deleteSavedPoint as deleteStoredSavedPoint,
  isFogCacheValid,
} from "~/lib/storage"
import { clearMapPosition } from "~/lib/mapStore"
import { clearRenderedActivityState } from "~/lib/map/commands"
import { activitiesFeatureCollection } from "~/lib/map/geojson"
import { initAuth, useAuth } from "~/lib/server/authStore"
import { apiUrl, isServerEnabled } from "~/lib/server/config"
import {
  ignoreActivityLocally,
  requestSync,
  setSyncChangeHandler,
  startSyncScheduler,
  suspendAutoSync,
  pushSavedPointDeletion,
  pushSavedPointUpdate,
} from "~/lib/server/syncEngine"
import { useMyLocation } from "~/lib/useMyLocation"
import { useActivityVisibility } from "~/lib/useActivityVisibility"
import { socialMeta } from "~/lib/socialMeta"
import type { FogMode, MapMode, ParsedActivity } from "~/types/activities"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import {
  isSavedPointColor,
  isValidSavedPointInput,
  type SavedPoint,
} from "~shared/saved-points"

export function meta({}: Route.MetaArgs) {
  return socialMeta({
    title: "Fog of Walk — Explore the unknown",
    description:
      "Import your GPX and FIT activity files. Watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.",
    path: "/map",
  })
}

async function loadPublicSavedPoint(id: string): Promise<SavedPoint | null> {
  if (!isServerEnabled) return null

  try {
    const response = await fetch(
      apiUrl(`/api/public/saved-points/${encodeURIComponent(id)}`)
    )
    if (!response.ok) return null
    const point = (await response.json()) as SavedPoint
    return isValidSavedPointInput(point) && point.id === id ? point : null
  } catch {
    return null
  }
}

// Module-level cache for restored photos — avoids passing File objects through
// React Router's serialized loader return type (which strips Blob/File methods).
let _restoredPhotos: PhotoEntry[] = []
let _restoredSavedPoints: SavedPoint[] = []

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<{
  initialized: boolean
  restoredActivityCount: number
  restoredFogMode: FogMode
  viewedSavedPoint: SavedPoint | null
}> {
  if (!mapStore.worker) {
    console.debug("[clientLoader] creating worker")
    mapStore.worker = new Worker(
      new URL("../workers/fogWorker.ts", import.meta.url),
      { type: "module" }
    )
    mapStore.worker.onerror = (e) => {
      console.error("[worker] uncaught error", e)
      fogCoordinator.handleWorkerFailure(e.error ?? e.message)
    }
    console.debug("[clientLoader] worker created", mapStore.worker)
  }

  // Sync is a map-only concern. The shared layout also wraps the library and
  // informational pages, so avoid even revalidating a stored sync session
  // while one of those pages is open. Deliberately do not await this: the map
  // must never wait on the network, and it is a no-op when no server exists.
  if (new URL(request.url).pathname === "/map") void initAuth()

  // Restore persisted data in parallel
  const [activities, photos, savedPoints, fogMode, fogCache] =
    await Promise.all([
      initializeActivityLibrary(),
      loadPhotos(),
      loadSavedPoints(),
      loadFogMode(),
      loadFogCache(),
    ])

  const restoredFogMode: FogMode = fogMode ?? "corridor"
  mapStore.fogMode = restoredFogMode
  _restoredPhotos = photos
  _restoredSavedPoints = savedPoints
  const savedPointId = new URL(request.url).searchParams.get("savedPoint")
  const viewedSavedPoint =
    savedPointId && !savedPoints.some((point) => point.id === savedPointId)
      ? await loadPublicSavedPoint(savedPointId)
      : null

  if (activities.length > 0) {
    const activityIds = activities.map((t) => t.id).sort()
    if (
      fogCache &&
      isFogCacheValid(
        fogCache,
        activityIds,
        restoredFogMode,
        mapStore.libraryRevision
      )
    ) {
      // Cache hit: restore fog directly — setupMapLayers will use mapStore.fogData
      mapStore.fogData = fogCache.fogData
      console.debug(
        "[clientLoader] restored fog cache for",
        activities.length,
        "activities"
      )
    } else {
      // Cache miss: fog will be null, world fog shown until worker reprocesses
      mapStore.fogData = null
      console.debug(
        "[clientLoader] fog cache stale/absent — will reprocess",
        activities.length,
        "activities"
      )
    }
  }

  // initialCenter/initialZoom are already loaded from localStorage at mapStore module init time.
  // No async needed — they're ready before any useEffect runs.

  console.debug(
    "[clientLoader] restored",
    activities.length,
    "activities,",
    photos.length,
    "photos"
  )
  return {
    initialized: true,
    restoredActivityCount: activities.length,
    restoredFogMode,
    viewedSavedPoint,
  }
}
clientLoader.hydrate = true as const

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "add-files") {
    const files = formData.getAll("files") as File[]
    const operationId = createUuid()
    const startedAt = Date.now()
    beginImport(operationId, files.length)
    recordDiagnostic({
      subsystem: "import",
      operationId,
      libraryRevision: mapStore.libraryRevision,
      stage: "accepted",
      itemCount: files.length,
      result: "started",
    })
    const commitState: { value: LibraryCommit | null } = { value: null }
    const importService = createActivityImportService({
      signal: request.signal,
      onProgress: (progress) => {
        reportImportProgress(progress)
        recordDiagnostic({
          subsystem: "import",
          operationId: progress.operationId,
          libraryRevision: mapStore.libraryRevision,
          stage: progress.stage,
          durationMs: Date.now() - startedAt,
          itemCount: progress.totalFiles,
          result: "progress",
        })
      },
      commit: (operationId, activities) =>
        activityLibrary
          .dispatch(
            { type: "import", operationId, activities },
            {
              outbox: isServerEnabled
                ? activities.flatMap((activity) => {
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
          .then((result) => {
            commitState.value = result
            return result
          }),
    })
    let batch
    try {
      batch = await importService.importFiles(files, operationId)
      completeImport(batch)
    } catch (error) {
      failImport(operationId, error)
      recordDiagnostic({
        subsystem: "import",
        operationId,
        libraryRevision: mapStore.libraryRevision,
        stage: "complete",
        durationMs: Date.now() - startedAt,
        itemCount: files.length,
        result: "failed",
        errorCode: "import-failed",
        retryability: "retryable",
      })
      const failure =
        error instanceof Error
          ? error.message
          : "The activity files could not be imported."
      const failedFileDetails: ImportFailureSummary[] = files.map((file) => ({
        name: file.name,
        status: "failed",
        error: failure,
      }))
      return {
        intent: "add-files" as const,
        count: files.length,
        activityCount: mapStore.activities.length,
        newActivitiesCount: 0,
        duplicateCount: 0,
        missingActivityTypeCount: 0,
        failedFiles: failedFileDetails.map((file) => file.name),
        failedFileDetails,
      }
    }
    const added = commitState.value?.change.added ?? []
    const failedOutcomes = batch.files.filter((file) =>
      ["failed", "rejected", "cancelled"].includes(file.status)
    )
    const importResult = batch.cancelled
      ? ("cancelled" as const)
      : failedOutcomes.length === 0
        ? ("success" as const)
        : added.length > 0 ||
            batch.activities.some((activity) => activity.status === "duplicate")
          ? ("partial" as const)
          : ("failed" as const)
    const firstErrorCode = failedOutcomes.find(
      (file) => file.errorCode
    )?.errorCode
    recordDiagnostic({
      subsystem: "import",
      operationId,
      libraryRevision: mapStore.libraryRevision,
      stage: "complete",
      durationMs: Date.now() - startedAt,
      itemCount: batch.files.length,
      pointCount: added.reduce(
        (count, activity) => count + activity.coordinates.length,
        0
      ),
      result: importResult,
      ...(firstErrorCode ? { errorCode: firstErrorCode } : {}),
      retryability: failedOutcomes.length > 0 ? "retryable" : null,
    })
    if (added.length > 0) {
      void requestSync("add-files")
    }
    const failedFiles = batch.files
      .filter((file) =>
        ["failed", "rejected", "cancelled"].includes(file.status)
      )
      .map((file) => file.name)
    const failedFileDetails: ImportFailureSummary[] = batch.files
      .filter((file) =>
        ["failed", "rejected", "cancelled"].includes(file.status)
      )
      .map((file) => ({
        name: file.name,
        status: file.status as ImportFailureSummary["status"],
        ...(file.errorCode ? { errorCode: file.errorCode } : {}),
        ...(file.error ? { error: file.error } : {}),
      }))
    const duplicateCount = batch.activities.filter(
      (activity) => activity.status === "duplicate"
    ).length
    return {
      intent: "add-files" as const,
      count: files.length,
      activityCount: mapStore.activities.length,
      // Must be what was ingested, not what was parsed — the progress UI waits
      // on a worker DONE that only arrives if something was actually posted.
      newActivitiesCount: added.length,
      duplicateCount,
      missingActivityTypeCount: added.filter(
        (activity) => activity.activityType == null
      ).length,
      failedFiles,
      failedFileDetails,
    }
  }

  if (intent === "clear-all") {
    // Local only, deliberately. This resets *this device*; the server copies
    // are left alone and sync pulls them back. Deleting them is a separate,
    // explicit action — "Remove all" in the account dialog.
    await initializeActivityLibrary()
    await activityLibrary.dispatch({
      type: "clearLocal",
      operationId: createUuid(),
    })
    // Runs synchronously before the fetcher effect resets React selection state.
    clearRenderedActivityState()
    await clearAll({ includeActivities: false })
    clearMapPosition()
    // Pause automatic syncing. `clearAll` dropped syncState, so the next sync
    // walks from scratch and would download everything straight back — the
    // clear would undo itself within seconds. It resumes on reload, or when
    // the user asks for it with "Sync now".
    suspendAutoSync("clear-all")
    return { intent: "clear-all" as const, activityCount: 0 }
  }

  if (intent === "delete-activity") {
    const activityId = formData.get("activityId") as string
    const deleteEverywhere = formData.get("alsoOnServer") !== "0"

    await initializeActivityLibrary()

    // Captured before the filter — the content hash is what the server keys on.
    const deletedActivity = mapStore.activities.find((t) => t.id === activityId)

    const operationId = createUuid()
    await activityLibrary.dispatch(
      {
        type: "delete",
        operationId,
        activityId,
      },
      {
        outbox:
          deleteEverywhere && isServerEnabled && deletedActivity
            ? (() => {
                const item = createActivityDeleteOutboxItem(
                  deletedActivity,
                  operationId,
                  activityLibrary.getSnapshot().revision
                )
                return item ? [item] : []
              })()
            : [],
      }
    )
    // The library subscription has already reset/rebuilt the fog projection for
    // the committed survivor revision. Clear the current map source before its
    // next validated snapshot arrives.
    clearRenderedActivityState()

    if (deletedActivity) {
      if (formData.get("alsoOnServer") === "0") {
        // Local-only: the server copy stays, so this device has to remember
        // not to download it back on the next sync.
        await ignoreActivityLocally(deletedActivity)
        suspendAutoSync("local-only-delete")
      } else requestSync("activity-deletion")
    }

    return {
      intent: "delete-activity" as const,
      activityCount: mapStore.activities.length,
    }
  }

  if (intent === "save-saved-point") {
    const id = formData.get("id")
    const name = formData.get("name")
    const description = formData.get("description")
    const color = formData.get("color")
    const isPublic = formData.get("isPublic")
    const lng = Number(formData.get("lng"))
    const lat = Number(formData.get("lat"))
    const errors: Record<string, string> = {}

    if (typeof name !== "string" || name.trim().length === 0) {
      errors.name = "Enter a name."
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.lng = "Enter a longitude between -180 and 180."
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.lat = "Enter a latitude between -90 and 90."
    }
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof description !== "string" ||
      !isSavedPointColor(color) ||
      (isPublic !== "true" && isPublic !== "false")
    ) {
      errors.form = "Enter valid saved point details."
    }
    if (Object.keys(errors).length > 0) {
      return { intent: "save-saved-point" as const, errors }
    }

    const input = {
      id: id as string,
      lng,
      lat,
      name: name as string,
      description: description as string,
      color: color as SavedPoint["color"],
      isPublic: isPublic === "true",
    }
    if (!isValidSavedPointInput(input)) {
      return {
        intent: "save-saved-point" as const,
        errors: { form: "Enter valid saved point details." },
      }
    }

    const existing = (await loadSavedPoints()).find((point) => point.id === id)
    const now = Date.now()
    const localPoint: SavedPoint = {
      ...input,
      description: input.description.trim() || null,
      name: input.name.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await saveSavedPoint(localPoint)
    const point = await pushSavedPointUpdate(localPoint)
    return { intent: "save-saved-point" as const, point }
  }

  if (intent === "delete-saved-point") {
    const id = formData.get("id")
    if (typeof id !== "string" || !id) {
      return {
        intent: "delete-saved-point" as const,
        errors: { form: "Saved point could not be deleted." },
      }
    }
    await deleteStoredSavedPoint(id)
    await pushSavedPointDeletion(id)
    return { intent: "delete-saved-point" as const, id }
  }

  return null
}

export default function Home() {
  const loaderData = useLoaderData<typeof clientLoader>()
  const fetcher = useFetcher<typeof clientAction>()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const revalidator = useRevalidator()
  const isMapRoute = location.pathname === "/map"
  // This parent route stays matched for every in-app page. Delay mounting the
  // expensive WebGL map for direct visits to another page, then keep it alive
  // for the rest of the document session after the first map visit.
  const [hasMountedMap, setHasMountedMap] = useState(isMapRoute)

  useEffect(() => {
    if (isMapRoute) setHasMountedMap(true)
  }, [isMapRoute])

  // Initialise from restored data (falls back to defaults on first load)
  const [activityCount, setActivityCount] = useState(
    loaderData.restoredActivityCount
  )
  const fogStatus = useFogStatus()
  const isProcessing =
    fogStatus.phase === "processing" || fogStatus.phase === "recovering"
  const [showActivities, setShowActivities] = useState(true)
  const [showFog, setShowFog] = useState(true)
  const [fogMode, setFogMode] = useState<FogMode>(loaderData.restoredFogMode)
  const [mapMode, setMapMode] = useState<MapMode>("flat")
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([])
  // Keyed by activity id, not a bare number: a bare number would still match
  // during the render in which the selection moves to a different activity that
  // happens to have that lap, flashing the wrong lap and refitting the camera.
  const [selectedLap, setSelectedLap] = useState<{
    activityId: string
    number: number
  } | null>(null)
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(
    null
  )
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [photos, setPhotos] = useState<PhotoEntry[]>(_restoredPhotos)
  const [showPhotos, setShowPhotos] = useState(true)
  const [savedPoints, setSavedPoints] =
    useState<SavedPoint[]>(_restoredSavedPoints)
  const [showSavedPoints, setShowSavedPoints] = useState(true)
  const [editingSavedPointId, setEditingSavedPointId] = useState<string | null>(
    null
  )
  const [viewingSavedPoint, setViewingSavedPoint] = useState<SavedPoint | null>(
    null
  )
  const displayedSavedPoints = useMemo(
    () =>
      viewingSavedPoint
        ? [
            ...savedPoints.filter((point) => point.id !== viewingSavedPoint.id),
            viewingSavedPoint,
          ]
        : savedPoints,
    [savedPoints, viewingSavedPoint]
  )
  const [newSavedPointCoordinate, setNewSavedPointCoordinate] = useState<
    [number, number] | null
  >(null)

  function clearSearchParam(name: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(name)
        return next
      },
      { replace: true }
    )
  }

  function closeSavedPointDialog() {
    setEditingSavedPointId(null)
    setNewSavedPointCoordinate(null)
    setViewingSavedPoint(null)
    clearSearchParam("savedPoint")
  }
  const {
    showMyLocation,
    permissionDenied: locationPermissionDenied,
    position: myLocationPosition,
    toggle: handleShowMyLocationChange,
  } = useMyLocation()
  const [selectedGroup, setSelectedGroup] = useState<PhotoGroup | null>(null)
  const [photoErrorOpen, setPhotoErrorOpen] = useState(false)
  const [parseFailedFiles, setParseFailedFiles] = useState<string[]>([])
  const [parseFailureDetails, setParseFailureDetails] = useState<
    ImportFailureSummary[]
  >([])
  const [isParseErrorOpen, setIsParseErrorOpen] = useState(false)
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [shareRetryCount, setShareRetryCount] = useState(0)
  const [missingActivityTypeCount, setMissingActivityTypeCount] = useState(0)
  const [isMissingActivityTypeOpen, setIsMissingActivityTypeOpen] =
    useState(false)
  // Loading overlay: starts visible, fades out when map is ready, then unmounts
  const [overlayDone, setOverlayDone] = useState(false)

  // The cached map keeps its layout while hidden, but MapLibre still needs a
  // resize after returning from a page that may have changed the viewport.
  useEffect(() => {
    if (!isMapRoute || !mapReady) return
    const frame = requestAnimationFrame(() => mapStore.map?.resize())
    return () => cancelAnimationFrame(frame)
  }, [isMapRoute, mapReady])

  // Reprocess flag: true when activities were restored but fog cache was stale/absent.
  // mapStore.fogData is null in that case; checked once after map is ready.
  const needsReprocessRef = useRef(
    loaderData.restoredActivityCount > 0 && mapStore.fogData === null
  )
  // Set to true when the user uploads new files; cleared after fitBounds fires.
  // Restore-reprocesses and fog-mode reprocesses should not zoom the map.
  const isNewUploadRef = useRef(false)
  // Activity count before the latest upload so fitBounds can identify the new activities.
  const prevActivityCountRef = useRef(0)
  // Share-target entries stay in Cache Storage until the import action returns
  // a terminal result. Keeping the request keys lets a parse/storage failure
  // remain retryable after reload instead of losing the shared files.
  const pendingShareRequestsRef = useRef<Request[]>([])

  // A fresh OAuth sign-in can start syncing while this loader is still reading
  // IndexedDB. In that case its first result contains no activities, then the
  // sync write triggers a revalidation with the downloaded activities. The ref
  // above is intentionally initialized only once, so reconcile that later
  // loader result here. If the worker already ran before MapView mounted, its
  // replies were unobserved; discard that run and replay it once the listener
  // is installed.
  useEffect(() => {
    if (loaderData.restoredActivityCount === 0 || mapStore.fogData !== null) {
      return
    }

    if (
      fogCoordinator.activeRequest !== null ||
      fogCoordinator.queuedSnapshot !== null
    ) {
      if (mapStore.isFogWorkerListenerReady) return
      rebuildFogProjection(mapStore.fogMode)
    }

    needsReprocessRef.current = true
    setActivityCount(mapStore.activities.length)
  }, [loaderData.restoredActivityCount])

  // Show upload dialog once the map is ready and no activities are loaded.
  // Use mapStore.activities (set synchronously by clientLoader) rather than the
  // activityCount React state, which can read as 0 during the brief window
  // between initial render and loader-data reconciliation.
  useEffect(() => {
    if (mapReady && mapStore.activities.length === 0) {
      setShowUploadDialog(true)
    }
  }, [mapReady])

  // Select and zoom to an activity when ?activity=<id> is present in the URL
  useEffect(() => {
    if (!mapReady) return
    const activityId = searchParams.get("activity")
    if (!activityId) return
    setSelectedActivityIds([activityId])
    const activity = mapStore.activities.find((t) => t.id === activityId)
    if (!activity || !mapStore.map) return
    const fc = activitiesFeatureCollection([activity])
    const [w, s, e, n] = bbox(fc)
    if (isFinite(w)) {
      mapStore.map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 80, maxZoom: 14 }
      )
    }
  }, [mapReady, searchParams])

  useEffect(() => {
    if (!mapReady) return
    const id = searchParams.get("savedPoint")
    if (!id) {
      // Saving replaces the local point before the URL update commits. That
      // intermediate render can briefly reselect the point from the stale
      // query parameter, so an empty URL must actively clear the editor.
      setEditingSavedPointId(null)
      setViewingSavedPoint(null)
      return
    }
    const ownedPoint = savedPoints.find((savedPoint) => savedPoint.id === id)
    const point = ownedPoint ?? loaderData.viewedSavedPoint
    if (!point || !mapStore.map) return
    mapStore.map.easeTo({
      center: [point.lng, point.lat],
      zoom: Math.max(mapStore.map.getZoom(), 16),
    })
    setEditingSavedPointId(ownedPoint?.id ?? null)
    setViewingSavedPoint(ownedPoint ? null : point)
  }, [loaderData.viewedSavedPoint, mapReady, savedPoints, searchParams])

  async function drainShareTargetQueue(): Promise<void> {
    if (!("caches" in window)) return
    try {
      const cache = await caches.open("share-target-queue")
      const keys = await cache.keys()
      if (keys.length === 0) {
        clearSearchParam("from-share")
        return
      }
      const files: File[] = []
      const importedRequests: Request[] = []
      for (const request of keys) {
        const response = await cache.match(request)
        if (!response) continue
        const name = response.headers.get("X-File-Name") ?? "file"
        const type = response.headers.get("Content-Type") ?? ""
        files.push(new File([await response.arrayBuffer()], name, { type }))
        importedRequests.push(request)
      }
      if (files.length === 0) return
      pendingShareRequestsRef.current = importedRequests
      const dataTransfer = new DataTransfer()
      files.forEach((file) => dataTransfer.items.add(file))
      handleAddFiles(dataTransfer.files)
    } catch (error) {
      console.warn("[share-target] queue read failed:", error)
    }
  }

  async function discardShareTargetQueue(): Promise<void> {
    pendingShareRequestsRef.current = []
    try {
      if ("caches" in window) {
        const cache = await caches.open("share-target-queue")
        for (const request of await cache.keys()) await cache.delete(request)
      }
    } catch (error) {
      console.warn("[share-target] queue discard failed:", error)
    } finally {
      clearSearchParam("from-share")
    }
  }

  // Handle files shared via the Web Share Target API (PWA installed).
  // The service worker retains the bytes until a terminal durable import. A
  // retry therefore reads the same queue again instead of relying on File
  // objects surviving navigation.
  useEffect(() => {
    if (!mapReady || !searchParams.has("from-share")) return
    void drainShareTargetQueue()
  }, [mapReady, searchParams, shareRetryCount])

  // Trigger worker reprocessing when fog cache was stale
  useEffect(() => {
    if (!mapReady || !needsReprocessRef.current) return
    needsReprocessRef.current = false
    if (mapStore.activities.length === 0) return
    rebuildFogProjection(loaderData.restoredFogMode)
  }, [mapReady])

  // Zoom to activities after a new upload finishes processing.
  // Using useEffect (instead of calling fitBounds directly inside the worker's
  // onmessage) guarantees we're in a normal render cycle where the map is
  // fully ready and React state is settled.
  // isNewUploadRef is only set for genuine add-files actions; restore-reprocesses
  // and fog-mode reprocesses leave it false so the map position is preserved.
  useEffect(() => {
    if (isProcessing || !isNewUploadRef.current) return
    isNewUploadRef.current = false
    const map = mapStore.map
    if (mapStore.activities.length === 0 || !map) return

    // Compute bbox for all activities and check the zoom needed to fit them.
    const allFc = activitiesFeatureCollection(mapStore.activities)
    const [w, s, e, n] = bbox(allFc)
    if (!isFinite(w)) return

    const allBounds: [[number, number], [number, number]] = [
      [w, s],
      [e, n],
    ]
    const camera = map.cameraForBounds(allBounds, { padding: 60, maxZoom: 14 })
    const wouldBeZoom =
      typeof camera?.zoom === "number" ? camera.zoom : Infinity

    if (wouldBeZoom >= 5) {
      // All activities fit at an acceptable zoom level — show them all.
      map.fitBounds(allBounds, { padding: 60, maxZoom: 14 })
    } else {
      // Activities are too spread out (different countries/continents). Zoom to
      // just the newly added ones so the user sees what they just uploaded.
      const newActivities = mapStore.activities.slice(
        prevActivityCountRef.current
      )
      if (newActivities.length === 0) return
      const newFc = activitiesFeatureCollection(newActivities)
      const [nw, ns, ne, nn] = bbox(newFc)
      if (isFinite(nw)) {
        map.fitBounds(
          [
            [nw, ns],
            [ne, nn],
          ],
          { padding: 60, maxZoom: 14 }
        )
      }
    }
  }, [isProcessing])

  // React to completed action (runs for both FileUploadDialog and ControlPanel submissions)
  useEffect(() => {
    const data = fetcher.data
    if (!data) return
    if (data.intent === "add-files") {
      const pendingShareRequests = pendingShareRequestsRef.current
      if (pendingShareRequests.length > 0 && data.failedFiles.length === 0) {
        pendingShareRequestsRef.current = []
        void caches
          .open("share-target-queue")
          .then(async (cache) => {
            for (const request of pendingShareRequests) {
              await cache.delete(request)
            }
            setSearchParams({}, { replace: true })
          })
          .catch((error) =>
            console.warn("[share-target] queue acknowledgement failed:", error)
          )
      }
      // Keep a failed share target addressable for a retry after reload. The
      // files remain in Cache Storage until a fully successful terminal import.
      prevActivityCountRef.current = activityCount // snapshot pre-upload count for fitBounds fallback
      setShowUploadDialog(false)
      if (data.newActivitiesCount > 0) {
        isNewUploadRef.current = true // triggers fitBounds in the isProcessing effect below
        setActivityCount(data.activityCount)
      }
      if (data.failedFiles.length > 0) {
        setMissingActivityTypeCount(data.missingActivityTypeCount)
        setParseFailedFiles(data.failedFiles)
        setParseFailureDetails(data.failedFileDetails)
        setIsParseErrorOpen(true)
      } else if (data.missingActivityTypeCount > 0) {
        setMissingActivityTypeCount(data.missingActivityTypeCount)
        setIsMissingActivityTypeOpen(true)
      } else if (data.newActivitiesCount === 0 && data.duplicateCount > 0) {
        // Nothing was added and nothing failed — say so, or the import looks
        // like it silently did nothing.
        setDuplicateCount(data.duplicateCount)
        setIsDuplicateOpen(true)
      }
    }
    if (data.intent === "clear-all") {
      setActivityCount(0)
      setSelectedActivityIds([])
      setPendingActivityId(null)
      setShowShareDialog(false)
      setPhotos([])
      setSelectedGroup(null)
    }
    if (data.intent === "delete-activity") {
      setSelectedActivityIds([])
      setPendingActivityId(null)
      setShowShareDialog(false)
      setActivityCount(data.activityCount)
    }
  }, [fetcher.data])

  // The library subscription updates the activity projection; reconcile the
  // route-only state that the sync engine cannot reach.
  // Do this only while the map is visible: the parent layout stays mounted for
  // every child page, but sync is intentionally inactive away from /map.
  useEffect(() => {
    if (!isMapRoute) return
    setSyncChangeHandler(
      ({
        downloadedCount,
        updatedCount,
        deletedIds,
        savedPoints: syncedSavedPoints = [],
        deletedSavedPointIds = [],
      }) => {
        setActivityCount(mapStore.activities.length)

        if (syncedSavedPoints.length > 0 || deletedSavedPointIds.length > 0) {
          setSavedPoints((current) => [
            ...current.filter(
              (point) =>
                !deletedSavedPointIds.includes(point.id) &&
                !syncedSavedPoints.some((saved) => saved.id === point.id)
            ),
            ...syncedSavedPoints,
          ])
        }

        if (deletedIds.length > 0) {
          // The library subscription already abandoned/rebuilt the worker run;
          // this callback only reconciles route selection and map sources.
          setSelectedActivityIds((prev) =>
            prev.filter((id) => !deletedIds.includes(id))
          )
          setPendingActivityId(null)
          clearRenderedActivityState()
        }

        if (
          downloadedCount > 0 ||
          updatedCount > 0 ||
          deletedIds.length > 0 ||
          syncedSavedPoints.length > 0 ||
          deletedSavedPointIds.length > 0
        ) {
          void revalidator.revalidate()
        }
      }
    )
    return () => setSyncChangeHandler(null)
  }, [isMapRoute, revalidator])

  // Fires on a restored session and on a fresh sign-in alike, then keeps the
  // map current. Navigation away from /map tears down the scheduler so other
  // pages make no automatic sync requests.
  const auth = useAuth()
  const isSyncEnabled = auth.status === "signedIn" && auth.canSync
  useEffect(() => {
    if (!isMapRoute || !isSyncEnabled) return
    requestSync("auth-ready")
    return startSyncScheduler()
  }, [isMapRoute, isSyncEnabled])

  const visibility = useActivityVisibility(() => {
    void revalidator.revalidate()
  })

  function handleAddFiles(files: FileList, mode: FogMode = fogMode) {
    const formData = new FormData()
    formData.append("intent", "add-files")
    formData.append("mode", mode)
    for (const file of files) formData.append("files", file)
    fetcher.submit(formData, {
      method: "post",
      action: "/map",
      encType: "multipart/form-data",
    })
  }

  function handleClearAll() {
    photos.forEach((p) => {
      if (p.objectUrl) URL.revokeObjectURL(p.objectUrl)
    })
    // Release the cached share-card map bitmap so the GPU memory is freed
    if (mapStore.shareCardCache) {
      mapStore.shareCardCache.baseMap.close()
      mapStore.shareCardCache = null
    }
    const formData = new FormData()
    formData.append("intent", "clear-all")
    fetcher.submit(formData, { method: "post", action: "/map" })
  }

  function handleDeleteActivity(activityId: string, alsoOnServer = true) {
    const fd = new FormData()
    fd.set("intent", "delete-activity")
    fd.set("activityId", activityId)
    fd.set("alsoOnServer", alsoOnServer ? "1" : "0")
    fetcher.submit(fd, { method: "post", action: "/map" })
  }

  async function handleAddPhotos(files: FileList) {
    const newEntries = await processPhotoFiles(
      Array.from(files),
      mapStore.activities,
      photos
    )
    if (newEntries.length > 0) {
      setPhotos((prev) => [...prev, ...newEntries])
      setShowPhotos(true)
      savePhotos(newEntries) // fire-and-forget; quota-aware
    } else {
      setPhotoErrorOpen(true)
    }
  }

  async function handleLoadSampleData() {
    const response = await fetch("/sample-run.gpx")
    const blob = await response.blob()
    const file = new File([blob], "sample-run.gpx", {
      type: "application/gpx+xml",
    })
    const formData = new FormData()
    formData.append("intent", "add-files")
    formData.append("mode", fogMode)
    formData.append("files", file)
    fetcher.submit(formData, {
      method: "post",
      action: "/map",
      encType: "multipart/form-data",
    })
  }

  function handleFogModeChange(newMode: FogMode) {
    setFogMode(newMode)
    mapStore.fogMode = newMode
    saveFogMode(newMode) // fire-and-forget
    // The old cache carries its mode and is rejected on reload. Do not delete it
    // asynchronously here: that deletion can otherwise race and erase the fresh
    // cache written by a very fast reprocess.
    // Abandon whatever the worker is still chewing on: a rapid corridor↔fill
    // toggle must start the new mode immediately rather than queue behind the
    // old one. Replies from the abandoned run are dropped by their stale runId.
    rebuildFogProjection(newMode)
  }

  function handleProcessingComplete() {
    setActivityCount(mapStore.activities.length)
    // fitBounds is handled by the useEffect([isProcessing]) above:
    // it fires after React re-renders, when map state is fully settled.
  }

  function handleActivitySelect(id: string | null) {
    // Dropped on every selection change so reopening an activity starts on the
    // whole activity rather than silently restoring a zoomed-in lap. The
    // activityId key on selectedLap covers everything this doesn't reach.
    setSelectedLap(null)
    if (!id) {
      setSelectedActivityIds([])
      setPendingActivityId(null)
      return
    }
    if (selectedActivityIds.includes(id)) {
      setSelectedActivityIds((prev) => prev.filter((x) => x !== id))
      setPendingActivityId(null)
      return
    }
    if (selectedActivityIds.length === 0) {
      setSelectedActivityIds([id])
    } else {
      setPendingActivityId(id)
    }
  }

  const selectedActivities = useMemo(
    () =>
      selectedActivityIds
        .map((id) => mapStore.activities.find((t) => t.id === id))
        .filter((t): t is ParsedActivity => t != null),
    [selectedActivityIds, activityCount, loaderData]
  )

  // Derived and re-validated every render rather than reset imperatively: a
  // stale selection, a multi-select, a deleted activity or a GPX activity all
  // collapse to null on their own, so none of the many places that mutate
  // selectedActivityIds need to know laps exist.
  const activeLap =
    selectedActivities.length === 1 &&
    selectedLap?.activityId === selectedActivities[0].id
      ? (selectedActivities[0].laps?.find(
          (l) => l.number === selectedLap.number
        ) ?? null)
      : null

  function handleLapSelect(lapNumber: number | null) {
    const activityId = selectedActivities[0]?.id
    setSelectedLap(
      lapNumber != null && activityId ? { activityId, number: lapNumber } : null
    )
  }

  // Memoized: a fresh object each render would invalidate ShareDialog's
  // statsData/activityPhotos memos and re-fire its preview draw continuously.
  const activeLapActivity = useMemo(
    () =>
      activeLap ? buildLapActivity(selectedActivities[0], activeLap) : null,
    [selectedActivities[0]?.id, activeLap]
  )

  // Highlight is lap-only, so picking "All laps" clears lap-layer. Focus is
  // separate: on "All laps" it points at the whole activity, which is what lets
  // the camera zoom back out. Both null for activities without laps, so a plain
  // activity selection never becomes a camera target.
  //
  // Not gated on isProcessing: an import's whole-library fitBounds runs from
  // the worker DONE handler, strictly after any render-time fit, so it wins on
  // its own. Suppressing during processing would only add a second refit after.
  const focusActivity =
    selectedActivities.length === 1 &&
    (selectedActivities[0].laps?.length ?? 0) >= 2
      ? selectedActivities[0]
      : null
  const highlightCoordinates = activeLapActivity?.coordinates ?? null
  const focusCoordinates =
    activeLapActivity?.coordinates ?? focusActivity?.coordinates ?? null
  const focusKey =
    activeLapActivity?.id ?? (focusActivity ? `${focusActivity.id}#all` : null)

  const pendingActivity = pendingActivityId
    ? (mapStore.activities.find((t) => t.id === pendingActivityId) ?? null)
    : null

  return (
    <>
      {hasMountedMap && (
        <div
          data-map-cache
          aria-hidden={isMapRoute ? undefined : "true"}
          inert={isMapRoute ? undefined : true}
          className={
            isMapRoute
              ? "relative h-screen w-screen overflow-hidden"
              : "pointer-events-none invisible fixed inset-0 overflow-hidden"
          }
        >
          {/* Dark overlay: hides the white→tiles→fog flash; fades out once map is ready */}
          {!overlayDone && (
            <div
              className="pointer-events-none absolute inset-0 z-50 transition-opacity duration-500"
              style={{ backgroundColor: "#0a0a1e", opacity: mapReady ? 0 : 1 }}
              onTransitionEnd={() => setOverlayDone(true)}
            />
          )}
          <ErrorBoundary>
            <MapView
              showActivities={showActivities}
              showFog={showFog}
              onMapReady={() => setMapReady(true)}
              onProcessingComplete={handleProcessingComplete}
              selectedActivityIds={selectedActivityIds}
              onActivitySelect={handleActivitySelect}
              mapMode={mapMode}
              photos={photos}
              showPhotos={showPhotos}
              onPhotoSelect={setSelectedGroup}
              showMyLocation={showMyLocation}
              myLocation={myLocationPosition}
              highlightCoordinates={highlightCoordinates}
              focusCoordinates={focusCoordinates}
              focusKey={focusKey}
              savedPoints={displayedSavedPoints}
              showSavedPoints={showSavedPoints || viewingSavedPoint !== null}
              onSavedPointSelect={(id) => {
                setViewingSavedPoint(null)
                setEditingSavedPointId(id)
              }}
              onSavedPointCreate={({ lng, lat }) => {
                setViewingSavedPoint(null)
                setEditingSavedPointId(null)
                setNewSavedPointCoordinate([lng, lat])
              }}
            />
          </ErrorBoundary>
          {mapReady && isMapRoute && (
            <>
              <ControlPanel
                activityCount={activityCount}
                isProcessing={isProcessing}
                showActivities={showActivities}
                onShowActivitiesChange={setShowActivities}
                showFog={showFog}
                onShowFogChange={setShowFog}
                fogMode={fogMode}
                onFogModeChange={handleFogModeChange}
                onRetryFog={() => rebuildFogProjection(mapStore.fogMode)}
                mapMode={mapMode}
                onMapModeChange={setMapMode}
                onAddFiles={handleAddFiles}
                onClearAll={handleClearAll}
                photoCount={photos.length}
                onAddPhotos={handleAddPhotos}
                showPhotos={showPhotos}
                onShowPhotosChange={setShowPhotos}
                showMyLocation={showMyLocation}
                onShowMyLocationChange={handleShowMyLocationChange}
                locationPermissionDenied={locationPermissionDenied}
                savedPointCount={savedPoints.length}
                showSavedPoints={showSavedPoints}
                onShowSavedPointsChange={setShowSavedPoints}
              />
              {(editingSavedPointId || newSavedPointCoordinate) && (
                <DraggableSavedPointEditDialog
                  point={
                    savedPoints.find(
                      (point) => point.id === editingSavedPointId
                    ) ?? null
                  }
                  coordinate={newSavedPointCoordinate}
                  onClose={closeSavedPointDialog}
                  onSave={(point) => {
                    setSavedPoints((points) => [
                      ...points.filter((saved) => saved.id !== point.id),
                      point,
                    ])
                    closeSavedPointDialog()
                  }}
                  onDelete={
                    editingSavedPointId
                      ? (id) => {
                          setSavedPoints((points) =>
                            points.filter((point) => point.id !== id)
                          )
                          closeSavedPointDialog()
                        }
                      : undefined
                  }
                />
              )}
              {viewingSavedPoint && (
                <DraggableSavedPointViewDialog
                  key={viewingSavedPoint.id}
                  point={viewingSavedPoint}
                  onClose={closeSavedPointDialog}
                />
              )}
              <FileUploadDialog
                open={showUploadDialog}
                onOpenChange={setShowUploadDialog}
                onAddFiles={(files) => handleAddFiles(files, fogMode)}
                onLoadSampleData={handleLoadSampleData}
              />
              <PhotoErrorDialog
                open={photoErrorOpen}
                onOpenChange={setPhotoErrorOpen}
              />
              <ParseErrorDialog
                open={isParseErrorOpen}
                onOpenChange={(open) => {
                  setIsParseErrorOpen(open)
                  if (!open && missingActivityTypeCount > 0) {
                    setIsMissingActivityTypeOpen(true)
                  }
                }}
                failedFiles={parseFailedFiles}
                failureDetails={parseFailureDetails}
                canRetry={searchParams.has("from-share")}
                onRetry={() => {
                  setIsParseErrorOpen(false)
                  setShareRetryCount((count) => count + 1)
                }}
                onDiscard={() => {
                  setIsParseErrorOpen(false)
                  void discardShareTargetQueue()
                }}
              />
              <MissingActivityTypeDialog
                open={isMissingActivityTypeOpen}
                onOpenChange={(open) => {
                  setIsMissingActivityTypeOpen(open)
                  if (!open) setMissingActivityTypeCount(0)
                }}
                activityCount={missingActivityTypeCount}
              />
              <DuplicateActivitiesDialog
                open={isDuplicateOpen}
                onOpenChange={setIsDuplicateOpen}
                duplicateCount={duplicateCount}
              />
              <DraggablePhotoDialog
                group={selectedGroup}
                onClose={() => setSelectedGroup(null)}
              />
              {selectedActivities.length > 0 && (
                <ErrorBoundary
                  fallback={(error, reset) => (
                    <div className="absolute right-4 bottom-4 z-10 w-80">
                      <ErrorCard error={error} reset={reset} className="" />
                    </div>
                  )}
                >
                  <DraggableActivityDialog
                    activities={selectedActivities}
                    onRemoveActivity={(id) =>
                      setSelectedActivityIds((prev) =>
                        prev.filter((x) => x !== id)
                      )
                    }
                    onClose={() => {
                      setSelectedActivityIds([])
                      setSelectedLap(null)
                      setPendingActivityId(null)
                      clearSearchParam("activity")
                    }}
                    onShare={() => setShowShareDialog(true)}
                    onDelete={
                      selectedActivities.length === 1
                        ? (alsoOnServer) =>
                            handleDeleteActivity(
                              selectedActivities[0].id,
                              alsoOnServer
                            )
                        : undefined
                    }
                    activeLap={activeLap}
                    onLapSelect={handleLapSelect}
                    onVisibilityChange={
                      isSyncEnabled && selectedActivities.length === 1
                        ? (isPublic) =>
                            visibility.change(selectedActivities[0], isPublic)
                        : undefined
                    }
                    isVisibilityLoading={visibility.isLoading}
                  />
                </ErrorBoundary>
              )}
              {showShareDialog && selectedActivities.length > 0 && (
                <ShareDialog
                  open={showShareDialog}
                  onOpenChange={setShowShareDialog}
                  activities={
                    activeLapActivity ? [activeLapActivity] : selectedActivities
                  }
                  photos={photos}
                  subtitle={
                    activeLap
                      ? lapSubtitle(selectedActivities[0], activeLap)
                      : undefined
                  }
                />
              )}
              {pendingActivity && (
                <Dialog
                  open
                  onOpenChange={(open) => {
                    if (!open) setPendingActivityId(null)
                  }}
                >
                  <DialogContent showCloseButton={false}>
                    <DialogHeader>
                      <DialogTitle>Add to stats?</DialogTitle>
                      <DialogDescription>
                        &ldquo;{pendingActivity.name}&rdquo;
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                      <Button
                        variant="outline"
                        onClick={() => setPendingActivityId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedActivityIds([pendingActivityId!])
                          setPendingActivityId(null)
                        }}
                      >
                        Replace
                      </Button>
                      <Button
                        onClick={() => {
                          setSelectedActivityIds((prev) => [
                            ...prev,
                            pendingActivityId!,
                          ])
                          setPendingActivityId(null)
                        }}
                      >
                        Add to stats
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </>
          )}
        </div>
      )}
      <Outlet />
    </>
  )
}
