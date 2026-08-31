import { useEffect, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import bbox from "@turf/bbox"
import { lineString } from "@turf/helpers"
import "maplibre-gl/dist/maplibre-gl.css"
import { mapStore } from "~/lib/mapStore"
import { saveMapPosition } from "~/lib/mapStore"
import { MAP_STYLE_URL } from "~/constants/fog"
import {
  applyActivitySelectionPaint,
  rehydrateMapPresentation,
  setActivitiesVisible,
  setFogVisible,
  setLapHighlightData,
} from "~/lib/map/commands"
import { setupMapLayers } from "~/lib/map/layers"
import { styleForMapMode } from "~/lib/map/styles"
import type { MapMode, ActivityCoords } from "~/types/activities"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"
import { MapCompass } from "~/components/MapCompass"
import { useFogWorkerBridge } from "~/components/map/useFogWorkerBridge"
import { useMyLocationMarker } from "~/components/map/useMyLocationMarker"
import { usePhotoMarkers } from "~/components/map/usePhotoMarkers"
import { useSavedPoints } from "~/components/map/useSavedPoints"
import {
  attachMapInteractions,
  type SavedPointCreateLocation,
} from "~/components/map/mapInteractions"

export { setLapHighlightData } from "~/lib/map/commands"

interface MapViewProps {
  onMapReady?: () => void
  onProcessingUpdate?: (count: number, done: boolean) => void
  showActivities: boolean
  showFog: boolean
  selectedActivityIds: string[]
  onActivitySelect: (id: string | null) => void
  mapMode: MapMode
  photos: PhotoEntry[]
  showPhotos: boolean
  onPhotoSelect: (group: PhotoGroup | null) => void
  showMyLocation: boolean
  /** Current geolocation as [lng, lat], or null while unavailable. */
  myLocation: [number, number] | null
  /** Geometry drawn on lap-layer. Null when the whole activity is shown. */
  highlightCoordinates: ActivityCoords | null
  /** Geometry the camera frames — the lap, or the whole activity on "All laps". */
  focusCoordinates: ActivityCoords | null
  /**
   * Identity of the current focus: "<activityId>#lap3", "<activityId>#all", or null.
   * The effect keys on this rather than on the coordinate arrays, whose
   * `slice()` returns a fresh array every render and would refit continuously.
   */
  focusKey: string | null
  savedPoints: SavedPoint[]
  showSavedPoints: boolean
  onSavedPointSelect: (id: string) => void
  onSavedPointCreate?: (location: SavedPointCreateLocation) => void
}

export function MapView({
  onMapReady,
  onProcessingUpdate,
  showActivities,
  showFog,
  selectedActivityIds,
  onActivitySelect,
  mapMode,
  photos,
  showPhotos,
  onPhotoSelect,
  showMyLocation,
  myLocation,
  highlightCoordinates,
  focusCoordinates,
  focusKey,
  savedPoints,
  showSavedPoints,
  onSavedPointSelect,
  onSavedPointCreate,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onActivitySelectRef = useRef(onActivitySelect)
  onActivitySelectRef.current = onActivitySelect
  const showActivitiesRef = useRef(showActivities)
  showActivitiesRef.current = showActivities
  const showFogRef = useRef(showFog)
  showFogRef.current = showFog
  const selectedActivityIdsRef = useRef(selectedActivityIds)
  selectedActivityIdsRef.current = selectedActivityIds
  const highlightCoordinatesRef = useRef(highlightCoordinates)
  highlightCoordinatesRef.current = highlightCoordinates
  // Previous focus, so the effect can tell "switched lap view within an activity"
  // (refit) from "a different activity just got selected" (leave the camera).
  const prevFocusKeyRef = useRef<string | null>(null)
  const pendingStyleLoadRef = useRef<(() => void) | null>(null)
  const isInitialStyleLoadedRef = useRef(false)
  const onSavedPointSelectRef = useRef(onSavedPointSelect)
  onSavedPointSelectRef.current = onSavedPointSelect
  const onSavedPointCreateRef = useRef(onSavedPointCreate)
  onSavedPointCreateRef.current = onSavedPointCreate
  const savedPointsRef = useRef(savedPoints)
  savedPointsRef.current = savedPoints
  const showSavedPointsRef = useRef(showSavedPoints)
  showSavedPointsRef.current = showSavedPoints

  const [bearing, setBearing] = useState(0)
  const [pitch, setPitch] = useState(0)
  const setSavedPointTooltip = useSavedPoints(savedPoints, showSavedPoints)
  const { invalidateActivitiesCache } = useFogWorkerBridge(onProcessingUpdate)
  const { rebuildPhotoMarkers } = usePhotoMarkers(
    photos,
    showPhotos,
    onPhotoSelect
  )

  useEffect(() => {
    if (!containerRef.current || mapStore.map) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: mapStore.initialCenter ?? [15, 50],
      zoom: mapStore.initialZoom ?? 5,
      minZoom: 5,
      pitch: 0,
      attributionControl: { compact: false },
      // preserveDrawingBuffer is required for map.getCanvas() capture in the share export
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapStore.map = map

    map.on("rotate", () => setBearing(map.getBearing()))
    map.on("pitch", () => setPitch(map.getPitch()))

    // Persist map position synchronously on every moveend.
    // localStorage writes are synchronous so there's no async/timer race on page unload.
    map.on("moveend", () => {
      const c = map.getCenter()
      saveMapPosition([c.lng, c.lat], map.getZoom())
    })

    const detachMapInteractions = attachMapInteractions(map, {
      isShowingSavedPoints: () => showSavedPointsRef.current,
      getSavedPoints: () => savedPointsRef.current,
      onActivitySelect: (id) => onActivitySelectRef.current(id),
      onSavedPointSelect: (id) => onSavedPointSelectRef.current(id),
      onSavedPointCreate: (location) =>
        onSavedPointCreateRef.current?.(location),
      onSavedPointTooltipChange: setSavedPointTooltip,
    })

    map.once("load", () => {
      map.resize()
      setupMapLayers(map, "flat")
      rehydrateMapPresentation(map, {
        showActivities: showActivitiesRef.current,
        showFog: showFogRef.current,
        selectedActivityIds: selectedActivityIdsRef.current,
        highlightCoordinates: highlightCoordinatesRef.current,
        savedPoints: savedPointsRef.current,
        showSavedPoints: showSavedPointsRef.current,
      })
      mapStore.sourcesReady = true
      isInitialStyleLoadedRef.current = true
      onMapReady?.()
    })

    map.on("zoomend", () => rebuildPhotoMarkers())

    return () => {
      detachMapInteractions()
      mapStore.sourcesReady = false
      mapStore.map = null
      if (pendingStyleLoadRef.current) {
        map.off("style.load", pendingStyleLoadRef.current)
        pendingStyleLoadRef.current = null
      }
      map.remove()
    }
  }, [])

  // Declared after map initialization so its first effect sees the live map.
  useMyLocationMarker(showMyLocation, myLocation)

  useEffect(() => {
    const map = mapStore.map
    // The first style is installed by the map constructor. Controls are not
    // mounted until its load callback runs, so this only skips the initial effect.
    if (!map || !isInitialStyleLoadedRef.current) return

    if (pendingStyleLoadRef.current) {
      map.off("style.load", pendingStyleLoadRef.current)
      pendingStyleLoadRef.current = null
    }

    mapStore.sourcesReady = false

    const onStyleLoad = () => {
      // A rapid second toggle removes this listener, but keep the identity
      // check as a guard against an already queued callback.
      if (pendingStyleLoadRef.current !== onStyleLoad) return
      map.off("style.load", onStyleLoad)
      pendingStyleLoadRef.current = null

      setupMapLayers(map, mapMode)

      // Invalidate activities cache so FOG_UPDATE re-pushes to the new source.
      invalidateActivitiesCache()
      rehydrateMapPresentation(map, {
        showActivities: showActivitiesRef.current,
        showFog: showFogRef.current,
        selectedActivityIds: selectedActivityIdsRef.current,
        highlightCoordinates: highlightCoordinatesRef.current,
        savedPoints: savedPointsRef.current,
        showSavedPoints: showSavedPointsRef.current,
      })

      map.easeTo({ pitch: mapMode === "relief" ? 45 : 0, duration: 400 })
      mapStore.sourcesReady = true
      rebuildPhotoMarkers()
    }

    pendingStyleLoadRef.current = onStyleLoad
    map.on("style.load", onStyleLoad)
    map.setStyle(styleForMapMode(mapMode))
  }, [mapMode, invalidateActivitiesCache])

  useEffect(() => {
    if (!mapStore.sourcesReady) return
    if (mapStore.map) setActivitiesVisible(mapStore.map, showActivities)
  }, [showActivities])

  // Push the lap geometry, then frame the current focus.
  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return

    const prevFocusKey = prevFocusKeyRef.current
    prevFocusKeyRef.current = focusKey

    setLapHighlightData(map, highlightCoordinates)

    // Only move the camera when staying within one activity's lap views — going
    // lap 3 → All frames the whole activity, All → lap 3 frames the lap. A missing
    // previous focus, or a different activity id, means this is a fresh selection,
    // where clicking an activity has never moved the camera.
    const activityIdOf = (key: string | null) => key?.split("#")[0] ?? null
    if (!prevFocusKey || activityIdOf(prevFocusKey) !== activityIdOf(focusKey))
      return

    const coords = focusCoordinates
    if (!coords || coords.length < 2) return
    const [minLng, minLat, maxLng, maxLat] = bbox(lineString(coords))
    if (!isFinite(minLng) || !isFinite(minLat)) return
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, maxZoom: 16 }
    )
  }, [focusKey])

  useEffect(() => {
    if (!mapStore.sourcesReady) return
    if (mapStore.map) setFogVisible(mapStore.map, showFog)
  }, [showFog])

  // isLapActive is derived rather than passed as its own prop — highlight
  // geometry is non-null exactly when a lap is selected.
  const isLapActive = highlightCoordinates != null
  useEffect(() => {
    if (!mapStore.sourcesReady || !mapStore.map) return
    applyActivitySelectionPaint(mapStore.map, selectedActivityIds, isLapActive)
  }, [selectedActivityIds, isLapActive])

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 h-screen" />
      <MapCompass
        bearing={bearing}
        pitch={pitch}
        onReset={() =>
          mapStore.map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })
        }
        className="absolute top-1.5 right-1.5 z-10 sm:top-3 sm:right-3"
      />
    </>
  )
}
