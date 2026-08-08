import { useState, useEffect, useMemo, useRef } from "react"
import { useFetcher, useLoaderData, useSearchParams } from "react-router"
import type maplibregl from "maplibre-gl"
import { featureCollection, lineString } from "@turf/helpers"
import bbox from "@turf/bbox"
import type { Route } from "./+types/home"
import { MapView, setLapHighlightData } from "~/components/MapView"
import { ControlPanel } from "~/components/ControlPanel"
import { FileUploadDialog } from "~/components/FileUploadDialog"
import { PhotoErrorDialog } from "~/components/PhotoErrorDialog"
import { ParseErrorDialog } from "~/components/ParseErrorDialog"
import { TrackStatsPanel } from "~/components/track-stats/TrackStatsPanel"
import { ShareDialog } from "~/components/ShareDialog"
import { PhotoCard } from "~/components/PhotoCard"
import { ErrorBoundary } from "~/components/ErrorBoundary"
import { ErrorCard } from "~/components/ErrorCard"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import {
  mapStore,
  worldFogGeoJSON,
  startFogRun,
  postToFogWorker,
} from "~/lib/mapStore"
import { parseFile } from "~/lib/parsers"
import { buildLapTrack, lapSubtitle } from "~/lib/laps"
import { processPhotoFiles } from "~/lib/photos"
import {
  saveTracks,
  loadTracks,
  savePhotos,
  loadPhotos,
  saveFogMode,
  loadFogMode,
  loadFogCache,
  clearFogCache,
  clearAll,
  deleteTrack,
  isFogCacheValid,
} from "~/lib/storage"
import { clearMapPosition } from "~/lib/mapStore"
import { initAuth } from "~/lib/server/authStore"
import { sortTracks, populateUniqueDistances } from "~/lib/statsAggregator"
import type { FogMode, MapMode, ParsedTrack } from "~/types/tracks"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Fog of Walk — Explore the unknown" },
    {
      name: "description",
      content:
        "Import your GPX and FIT activity files. Watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.",
    },
    { property: "og:type", content: "website" },
    { property: "og:title", content: "Fog of Walk" },
    {
      property: "og:description",
      content:
        "Import your GPX and FIT activity files. Watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.",
    },
    { property: "og:site_name", content: "Fog of Walk" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: "Fog of Walk" },
    {
      name: "twitter:description",
      content:
        "Import your GPX and FIT activity files. Watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.",
    },
  ]
}

// Module-level cache for restored photos — avoids passing File objects through
// React Router's serialized loader return type (which strips Blob/File methods).
let _restoredPhotos: PhotoEntry[] = []

export async function clientLoader(): Promise<{
  initialized: boolean
  restoredTrackCount: number
  restoredFogMode: FogMode
}> {
  if (!mapStore.worker) {
    console.debug("[clientLoader] creating worker")
    mapStore.worker = new Worker(
      new URL("../workers/fogWorker.ts", import.meta.url),
      { type: "module" }
    )
    mapStore.worker.onerror = (e) => console.error("[worker] uncaught error", e)
    console.debug("[clientLoader] worker created", mapStore.worker)
  }

  // Restore + revalidate the sync session. Deliberately not awaited: the map
  // must never wait on the network, and it is a no-op when the build has no
  // server. Signing in later re-renders the drawer through the auth store.
  void initAuth()

  // Restore persisted data in parallel
  const [tracks, photos, fogMode, fogCache] = await Promise.all([
    loadTracks(),
    loadPhotos(),
    loadFogMode(),
    loadFogCache(),
  ])

  const restoredFogMode: FogMode = fogMode ?? "corridor"
  mapStore.fogMode = restoredFogMode
  _restoredPhotos = photos

  if (tracks.length > 0) {
    mapStore.tracks = sortTracks(tracks)
    populateUniqueDistances(mapStore.tracks)
    const trackIds = tracks.map((t) => t.id).sort()
    if (fogCache && isFogCacheValid(fogCache, trackIds, restoredFogMode)) {
      // Cache hit: restore fog directly — setupMapLayers will use mapStore.fogData
      mapStore.fogData = fogCache.fogData
      console.debug(
        "[clientLoader] restored fog cache for",
        tracks.length,
        "tracks"
      )
    } else {
      // Cache miss: fog will be null, world fog shown until worker reprocesses
      mapStore.fogData = null
      mapStore.isRestoreReprocess = true
      console.debug(
        "[clientLoader] fog cache stale/absent — will reprocess",
        tracks.length,
        "tracks"
      )
    }
  }

  // initialCenter/initialZoom are already loaded from localStorage at mapStore module init time.
  // No async needed — they're ready before any useEffect runs.

  console.debug(
    "[clientLoader] restored",
    tracks.length,
    "tracks,",
    photos.length,
    "photos"
  )
  return {
    initialized: true,
    restoredTrackCount: tracks.length,
    restoredFogMode,
  }
}
clientLoader.hydrate = true as const

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "add-files") {
    const files = formData.getAll("files") as File[]
    const mode = formData.get("mode") as FogMode
    console.debug("[clientAction] add-files", {
      fileCount: files.length,
      mode,
      files: files.map((f) => f.name),
    })
    const allTracks: ParsedTrack[] = []
    const failedFiles: string[] = []
    const results = await Promise.allSettled(files.map((f) => parseFile(f)))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === "fulfilled" && r.value.length > 0) {
        console.debug(
          "[clientAction] parsed",
          files[i].name,
          "→",
          r.value.length,
          "tracks, first track coords:",
          r.value[0]?.coordinates.length
        )
        allTracks.push(...r.value)
      } else {
        if (r.status === "rejected") {
          console.warn(
            `[clientAction] failed to parse ${files[i].name}:`,
            r.reason
          )
        } else {
          console.warn(`[clientAction] no tracks found in ${files[i].name}`)
        }
        failedFiles.push(files[i].name)
      }
    }
    console.debug(
      "[clientAction] total tracks parsed:",
      allTracks.length,
      "worker ready:",
      !!mapStore.worker
    )
    if (allTracks.length > 0) {
      mapStore.tracks = sortTracks([...mapStore.tracks, ...allTracks])
      populateUniqueDistances(mapStore.tracks)
      // Joins the current run rather than starting one: only the new tracks are
      // posted, so this depends on the worker's accumulated state surviving.
      postToFogWorker({
        type: "PROCESS_TRACKS",
        tracks: allTracks,
        mode,
      })
      // Persist new tracks and invalidate stale fog cache
      await saveTracks(allTracks)
      await clearFogCache()
    }
    return {
      intent: "add-files" as const,
      count: files.length,
      trackCount: mapStore.tracks.length,
      newTracksCount: allTracks.length,
      failedFiles,
    }
  }

  if (intent === "clear-all") {
    mapStore.fogData = null
    mapStore.tracks = []
    mapStore.processedCount = 0
    // Abandons the in-flight run so its FOG_UPDATEs cannot repaint the map
    // we just cleared, and its DONE cannot save a stale fog cache.
    startFogRun()
    postToFogWorker({ type: "RESET" })
    const map = mapStore.map
    if (map && mapStore.sourcesReady) {
      ;(map.getSource("fog-source") as maplibregl.GeoJSONSource)?.setData(
        worldFogGeoJSON()
      )
      ;(map.getSource("tracks-source") as maplibregl.GeoJSONSource)?.setData(
        featureCollection([])
      )
      // Blanked here too — these run synchronously, before the fetcher effect
      // resets React state, so the old lap line would otherwise linger a frame.
      setLapHighlightData(map, null)
    }
    await clearAll()
    clearMapPosition()
    return { intent: "clear-all" as const, trackCount: 0 }
  }

  if (intent === "delete-track") {
    const trackId = formData.get("trackId") as string

    // Remove from in-memory store and recompute unique distances for remaining tracks
    mapStore.tracks = mapStore.tracks.filter((t) => t.id !== trackId)
    populateUniqueDistances(mapStore.tracks)
    mapStore.processedCount = 0

    // Reset worker + update map sources immediately
    // Abandons the in-flight run so its FOG_UPDATEs cannot repaint the map
    // we just cleared, and its DONE cannot save a stale fog cache.
    startFogRun()
    postToFogWorker({ type: "RESET" })
    const map = mapStore.map
    if (map && mapStore.sourcesReady) {
      ;(map.getSource("fog-source") as maplibregl.GeoJSONSource)?.setData(
        worldFogGeoJSON()
      )
      ;(map.getSource("tracks-source") as maplibregl.GeoJSONSource)?.setData(
        featureCollection([])
      )
      // Blanked here too — these run synchronously, before the fetcher effect
      // resets React state, so the old lap line would otherwise linger a frame.
      setLapHighlightData(map, null)
    }

    // Replay remaining tracks
    if (mapStore.tracks.length > 0) {
      postToFogWorker({
        type: "PROCESS_TRACKS",
        tracks: mapStore.tracks,
        mode: mapStore.fogMode,
      })
    }

    // Persist and invalidate fog cache
    await deleteTrack(trackId)
    await clearFogCache()

    return {
      intent: "delete-track" as const,
      trackCount: mapStore.tracks.length,
    }
  }

  return null
}

export default function Home() {
  const loaderData = useLoaderData<typeof clientLoader>()
  const fetcher = useFetcher<typeof clientAction>()
  const [searchParams, setSearchParams] = useSearchParams()

  // Initialise from restored data (falls back to defaults on first load)
  const [trackCount, setTrackCount] = useState(loaderData.restoredTrackCount)
  const [processedCount, setProcessedCount] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showTracks, setShowTracks] = useState(true)
  const [showFog, setShowFog] = useState(true)
  const [fogMode, setFogMode] = useState<FogMode>(loaderData.restoredFogMode)
  const [mapMode, setMapMode] = useState<MapMode>("flat")
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([])
  // Keyed by track id, not a bare number: a bare number would still match
  // during the render in which the selection moves to a different track that
  // happens to have that lap, flashing the wrong lap and refitting the camera.
  const [selectedLap, setSelectedLap] = useState<{
    trackId: string
    number: number
  } | null>(null)
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [photos, setPhotos] = useState<PhotoEntry[]>(_restoredPhotos)
  const [showPhotos, setShowPhotos] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<PhotoGroup | null>(null)
  const [photoErrorOpen, setPhotoErrorOpen] = useState(false)
  const [parseFailedFiles, setParseFailedFiles] = useState<string[]>([])
  const [isParseErrorOpen, setIsParseErrorOpen] = useState(false)
  // Loading overlay: starts visible, fades out when map is ready, then unmounts
  const [overlayDone, setOverlayDone] = useState(false)

  // Reprocess flag: true when tracks were restored but fog cache was stale/absent.
  // mapStore.fogData is null in that case; checked once after map is ready.
  const needsReprocessRef = useRef(
    loaderData.restoredTrackCount > 0 && mapStore.fogData === null
  )
  // Set to true when the user uploads new files; cleared after fitBounds fires.
  // Lets the isProcessing useEffect distinguish new uploads from restore-reprocesses
  // and fog-mode reprocesses (both of which should NOT zoom the map).
  const isNewUploadRef = useRef(false)
  // Track count before the latest upload so fitBounds can identify the new tracks.
  const prevTrackCountRef = useRef(0)

  // Show upload dialog once the map is ready and no tracks are loaded.
  // Use mapStore.tracks (set synchronously by clientLoader) rather than the
  // trackCount React state, which can read as 0 during the brief window
  // between initial render and loader-data reconciliation.
  useEffect(() => {
    if (mapReady && mapStore.tracks.length === 0) {
      setShowUploadDialog(true)
    }
  }, [mapReady])

  // Select and zoom to a track when ?track=<id> is present in the URL
  useEffect(() => {
    if (!mapReady) return
    const trackId = searchParams.get("track")
    if (!trackId) return
    setSelectedTrackIds([trackId])
    const track = mapStore.tracks.find((t) => t.id === trackId)
    if (!track || !mapStore.map) return
    const fc = featureCollection([lineString(track.coordinates)])
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
  }, [mapReady])

  // Handle files shared via the Web Share Target API (PWA installed).
  // The service worker intercepts the POST to /?share-target, buffers the files
  // in Cache Storage, then redirects to /?from-share. We drain the queue here.
  useEffect(() => {
    if (!mapReady || !searchParams.has("from-share")) return
    ;(async () => {
      if (!("caches" in window)) return
      const cache = await caches.open("share-target-queue")
      const keys = await cache.keys()
      if (keys.length === 0) return
      const files: File[] = []
      for (const req of keys) {
        const res = await cache.match(req)
        if (!res) continue
        const name = res.headers.get("X-File-Name") ?? "file"
        const type = res.headers.get("Content-Type") ?? ""
        files.push(new File([await res.arrayBuffer()], name, { type }))
        await cache.delete(req)
      }
      if (files.length > 0) {
        const dt = new DataTransfer()
        files.forEach((f) => dt.items.add(f))
        handleAddFiles(dt.files)
      }
      // Clean the URL so a page refresh doesn't re-trigger this effect
      setSearchParams({}, { replace: true })
    })()
  }, [mapReady])

  // Trigger worker reprocessing when fog cache was stale
  useEffect(() => {
    if (!mapReady || !needsReprocessRef.current) return
    needsReprocessRef.current = false
    if (mapStore.tracks.length === 0) return
    setIsProcessing(true)
    setProcessedCount(0)
    postToFogWorker({
      type: "PROCESS_TRACKS",
      tracks: mapStore.tracks,
      mode: loaderData.restoredFogMode,
    })
  }, [mapReady])

  // Zoom to tracks after a new upload finishes processing.
  // Using useEffect (instead of calling fitBounds directly inside the worker's
  // onmessage) guarantees we're in a normal render cycle where the map is
  // fully ready and React state is settled.
  // isNewUploadRef is only set for genuine add-files actions; restore-reprocesses
  // and fog-mode reprocesses leave it false so the map position is preserved.
  useEffect(() => {
    if (isProcessing || !isNewUploadRef.current) return
    isNewUploadRef.current = false
    const map = mapStore.map
    if (mapStore.tracks.length === 0 || !map) return

    // Compute bbox for all tracks and check the zoom needed to fit them.
    const allFc = featureCollection(
      mapStore.tracks.map((t) => lineString(t.coordinates))
    )
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
      // All tracks fit at an acceptable zoom level — show them all.
      map.fitBounds(allBounds, { padding: 60, maxZoom: 14 })
    } else {
      // Tracks are too spread out (different countries/continents). Zoom to
      // just the newly added ones so the user sees what they just uploaded.
      const newTracks = mapStore.tracks.slice(prevTrackCountRef.current)
      if (newTracks.length === 0) return
      const newFc = featureCollection(
        newTracks.map((t) => lineString(t.coordinates))
      )
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
      prevTrackCountRef.current = trackCount // snapshot pre-upload count for fitBounds fallback
      setShowUploadDialog(false)
      if (data.newTracksCount > 0) {
        isNewUploadRef.current = true // triggers fitBounds in the isProcessing effect below
        setTrackCount(data.trackCount)
        setIsProcessing(true)
        setProcessedCount(0)
      }
      if (data.failedFiles.length > 0) {
        setParseFailedFiles(data.failedFiles)
        setIsParseErrorOpen(true)
      }
    }
    if (data.intent === "clear-all") {
      setTrackCount(0)
      setProcessedCount(0)
      setIsProcessing(false)
      setSelectedTrackIds([])
      setPendingTrackId(null)
      setShowShareDialog(false)
      setPhotos([])
      setSelectedGroup(null)
    }
    if (data.intent === "delete-track") {
      setSelectedTrackIds([])
      setPendingTrackId(null)
      setShowShareDialog(false)
      setTrackCount(data.trackCount)
      if (data.trackCount > 0) {
        setIsProcessing(true)
        setProcessedCount(0)
      } else {
        setIsProcessing(false)
        setProcessedCount(0)
      }
    }
  }, [fetcher.data])

  function handleAddFiles(files: FileList, mode: FogMode = fogMode) {
    const formData = new FormData()
    formData.append("intent", "add-files")
    formData.append("mode", mode)
    for (const file of files) formData.append("files", file)
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" })
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
    fetcher.submit(formData, { method: "post" })
  }

  function handleDeleteTrack(trackId: string) {
    const fd = new FormData()
    fd.set("intent", "delete-track")
    fd.set("trackId", trackId)
    fetcher.submit(fd, { method: "post" })
  }

  async function handleAddPhotos(files: FileList) {
    const newEntries = await processPhotoFiles(
      Array.from(files),
      mapStore.tracks,
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
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" })
  }

  function handleFogModeChange(newMode: FogMode) {
    setFogMode(newMode)
    mapStore.fogMode = newMode
    saveFogMode(newMode) // fire-and-forget
    clearFogCache() // will be rebuilt after reprocessing
    // Abandon whatever the worker is still chewing on: a rapid corridor↔fill
    // toggle must start the new mode immediately rather than queue behind the
    // old one. Replies from the abandoned run are dropped by their stale runId.
    startFogRun()
    postToFogWorker({ type: "RESET" })
    if (mapStore.tracks.length === 0) {
      // Nothing to replay — clear the bar the abandoned run's DONE will no
      // longer clear.
      setIsProcessing(false)
      setProcessedCount(0)
      return
    }
    setIsProcessing(true)
    setProcessedCount(0)
    postToFogWorker({
      type: "PROCESS_TRACKS",
      tracks: mapStore.tracks,
      mode: newMode,
    })
  }

  function handleProcessingUpdate(count: number, done: boolean) {
    setProcessedCount(count)
    if (done) {
      setIsProcessing(false)
      setTrackCount(mapStore.tracks.length)
      // fitBounds is handled by the useEffect([isProcessing]) above:
      // it fires after React re-renders, when map state is fully settled.
    }
  }

  function handleTrackSelect(id: string | null) {
    // Dropped on every selection change so reopening a track starts on the
    // whole activity rather than silently restoring a zoomed-in lap. The
    // trackId key on selectedLap covers everything this doesn't reach.
    setSelectedLap(null)
    if (!id) {
      setSelectedTrackIds([])
      setPendingTrackId(null)
      return
    }
    if (selectedTrackIds.includes(id)) {
      setSelectedTrackIds((prev) => prev.filter((x) => x !== id))
      setPendingTrackId(null)
      return
    }
    if (selectedTrackIds.length === 0) {
      setSelectedTrackIds([id])
    } else {
      setPendingTrackId(id)
    }
  }

  const selectedTracks = selectedTrackIds
    .map((id) => mapStore.tracks.find((t) => t.id === id))
    .filter((t): t is ParsedTrack => t != null)

  // Derived and re-validated every render rather than reset imperatively: a
  // stale selection, a multi-select, a deleted track or a GPX track all
  // collapse to null on their own, so none of the many places that mutate
  // selectedTrackIds need to know laps exist.
  const activeLap =
    selectedTracks.length === 1 && selectedLap?.trackId === selectedTracks[0].id
      ? (selectedTracks[0].laps?.find((l) => l.number === selectedLap.number) ??
        null)
      : null

  function handleLapSelect(lapNumber: number | null) {
    const trackId = selectedTracks[0]?.id
    setSelectedLap(
      lapNumber != null && trackId ? { trackId, number: lapNumber } : null
    )
  }

  // Memoized: a fresh object each render would invalidate ShareDialog's
  // statsData/trackPhotos memos and re-fire its preview draw continuously.
  const activeLapTrack = useMemo(
    () => (activeLap ? buildLapTrack(selectedTracks[0], activeLap) : null),
    [selectedTracks[0]?.id, activeLap]
  )

  // Highlight is lap-only, so picking "All laps" clears lap-layer. Focus is
  // separate: on "All laps" it points at the whole track, which is what lets
  // the camera zoom back out. Both null for tracks without laps, so a plain
  // track selection never becomes a camera target.
  //
  // Not gated on isProcessing: an import's whole-library fitBounds runs from
  // the worker DONE handler, strictly after any render-time fit, so it wins on
  // its own. Suppressing during processing would only add a second refit after.
  const focusTrack =
    selectedTracks.length === 1 && (selectedTracks[0].laps?.length ?? 0) >= 2
      ? selectedTracks[0]
      : null
  const highlightCoordinates = activeLapTrack?.coordinates ?? null
  const focusCoordinates =
    activeLapTrack?.coordinates ?? focusTrack?.coordinates ?? null
  const focusKey =
    activeLapTrack?.id ?? (focusTrack ? `${focusTrack.id}#all` : null)

  const pendingTrack = pendingTrackId
    ? (mapStore.tracks.find((t) => t.id === pendingTrackId) ?? null)
    : null

  return (
    <div className="relative h-screen w-screen overflow-hidden">
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
          showTracks={showTracks}
          showFog={showFog}
          onMapReady={() => setMapReady(true)}
          onProcessingUpdate={handleProcessingUpdate}
          selectedTrackIds={selectedTrackIds}
          onTrackSelect={handleTrackSelect}
          mapMode={mapMode}
          photos={photos}
          showPhotos={showPhotos}
          onPhotoSelect={setSelectedGroup}
          highlightCoordinates={highlightCoordinates}
          focusCoordinates={focusCoordinates}
          focusKey={focusKey}
        />
      </ErrorBoundary>
      {mapReady && (
        <>
          <ControlPanel
            trackCount={trackCount}
            processedCount={processedCount}
            isProcessing={isProcessing}
            showTracks={showTracks}
            onShowTracksChange={setShowTracks}
            showFog={showFog}
            onShowFogChange={setShowFog}
            fogMode={fogMode}
            onFogModeChange={handleFogModeChange}
            mapMode={mapMode}
            onMapModeChange={setMapMode}
            onAddFiles={handleAddFiles}
            onClearAll={handleClearAll}
            photoCount={photos.length}
            onAddPhotos={handleAddPhotos}
            showPhotos={showPhotos}
            onShowPhotosChange={setShowPhotos}
          />
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
            onOpenChange={setIsParseErrorOpen}
            failedFiles={parseFailedFiles}
          />
          <PhotoCard
            group={selectedGroup}
            onClose={() => setSelectedGroup(null)}
          />
          {selectedTracks.length > 0 && (
            <ErrorBoundary
              fallback={(error, reset) => (
                <div className="absolute right-4 bottom-4 z-10 w-80">
                  <ErrorCard error={error} reset={reset} className="" />
                </div>
              )}
            >
              <TrackStatsPanel
                tracks={selectedTracks}
                onRemoveTrack={(id) =>
                  setSelectedTrackIds((prev) => prev.filter((x) => x !== id))
                }
                onClose={() => {
                  setSelectedTrackIds([])
                  setSelectedLap(null)
                  setPendingTrackId(null)
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev)
                      next.delete("track")
                      return next
                    },
                    { replace: true }
                  )
                }}
                onShare={() => setShowShareDialog(true)}
                onDelete={
                  selectedTracks.length === 1
                    ? () => handleDeleteTrack(selectedTracks[0].id)
                    : undefined
                }
                activeLap={activeLap}
                onLapSelect={handleLapSelect}
              />
            </ErrorBoundary>
          )}
          {showShareDialog && selectedTracks.length > 0 && (
            <ShareDialog
              open={showShareDialog}
              onOpenChange={setShowShareDialog}
              tracks={activeLapTrack ? [activeLapTrack] : selectedTracks}
              photos={photos}
              subtitle={
                activeLap
                  ? lapSubtitle(selectedTracks[0], activeLap)
                  : undefined
              }
            />
          )}
          {pendingTrack && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) setPendingTrackId(null)
              }}
            >
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Add to stats?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  &ldquo;{pendingTrack.name}&rdquo;
                </p>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => setPendingTrackId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedTrackIds([pendingTrackId!])
                      setPendingTrackId(null)
                    }}
                  >
                    Replace
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedTrackIds((prev) => [...prev, pendingTrackId!])
                      setPendingTrackId(null)
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
  )
}
