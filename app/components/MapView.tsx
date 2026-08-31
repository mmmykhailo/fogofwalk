import { useEffect, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
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
  setSavedPointsPresentation,
} from "~/lib/map/commands"
import { MAP_LAYER_IDS, setupMapLayers } from "~/lib/map/layers"
import { styleForMapMode } from "~/lib/map/styles"
import type { MapMode, ActivityCoords } from "~/types/activities"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"
import { MapCompass } from "~/components/MapCompass"
import { SavedPointTooltip } from "~/components/SavedPointTooltip"
import { useFogWorkerBridge } from "~/components/map/useFogWorkerBridge"
import { useMyLocationMarker } from "~/components/map/useMyLocationMarker"
import { usePhotoMarkers } from "~/components/map/usePhotoMarkers"

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
  onSavedPointCreate?: (location: {
    lng: number
    lat: number
    point: { x: number; y: number }
  }) => void
}

interface SavedPointTooltipState {
  name: string
  lngLat: [number, number]
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
  const savedPointTooltipMarkerRef = useRef<maplibregl.Marker | null>(null)
  const savedPointTooltipRootRef = useRef<Root | null>(null)
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
  const [savedPointTooltip, setSavedPointTooltip] =
    useState<SavedPointTooltipState | null>(null)
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

    const isSavedPointGesture = (point: maplibregl.Point) =>
      showSavedPointsRef.current &&
      map.queryRenderedFeatures(point, { layers: ["saved-points-hit-layer"] })
        .length > 0
    const isProtectedCreateGesture = (point: maplibregl.Point) => {
      if (isSavedPointGesture(point)) return true
      return (
        map.queryRenderedFeatures(point, { layers: ["activities-hit-layer"] })
          .length > 0
      )
    }
    const createSavedPoint = (
      lngLat: maplibregl.LngLat,
      point: maplibregl.Point
    ) => {
      onSavedPointCreateRef.current?.({
        lng: lngLat.lng,
        lat: lngLat.lat,
        point: { x: point.x, y: point.y },
      })
    }

    map.on("mouseenter", "saved-points-hit-layer", (event) => {
      if (!showSavedPointsRef.current) return
      map.getCanvas().style.cursor = "pointer"
      const savedPoint = event.features?.[0]
      const name = savedPoint?.properties?.name
      const coordinates =
        savedPoint?.geometry.type === "Point"
          ? savedPoint.geometry.coordinates
          : null
      if (
        typeof name !== "string" ||
        !name ||
        !coordinates ||
        typeof coordinates[0] !== "number" ||
        typeof coordinates[1] !== "number"
      )
        return
      setSavedPointTooltip({ name, lngLat: [coordinates[0], coordinates[1]] })
    })
    map.on("mouseleave", "saved-points-hit-layer", () => {
      map.getCanvas().style.cursor = ""
      setSavedPointTooltip(null)
    })

    // A normal click remains dedicated to map navigation and selection. Desktop
    // creation is deliberately only on the context menu.
    map.on("contextmenu", (event) => {
      event.preventDefault()
      if (isProtectedCreateGesture(event.point)) return
      createSavedPoint(event.lngLat, event.point)
    })

    const canvas = map.getCanvas()
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressPointerId: number | null = null
    let longPressStart: maplibregl.Point | null = null
    let longPressCancelled = false
    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer)
      longPressTimer = null
      longPressPointerId = null
      longPressStart = null
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return
      // A second finger means the user is beginning a map gesture, such as a
      // pinch; it must cancel the first finger's pending long press.
      if (!event.isPrimary) {
        longPressCancelled = true
        cancelLongPress()
        return
      }
      if (longPressTimer) return
      const bounds = canvas.getBoundingClientRect()
      const point = new maplibregl.Point(
        event.clientX - bounds.left,
        event.clientY - bounds.top
      )
      // Markers are DOM elements above the canvas. Never turn a press on one
      // into a create action, even when the map has not rendered a feature there.
      if (
        (event.target as Element | null)?.closest(".maplibregl-marker") ||
        isProtectedCreateGesture(point)
      )
        return
      longPressPointerId = event.pointerId
      longPressStart = point
      longPressCancelled = false
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        if (!longPressCancelled && longPressStart) {
          createSavedPoint(map.unproject(longPressStart), longPressStart)
        }
      }, 500)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== longPressPointerId || !longPressStart) return
      const bounds = canvas.getBoundingClientRect()
      const dx = event.clientX - bounds.left - longPressStart.x
      const dy = event.clientY - bounds.top - longPressStart.y
      if (Math.hypot(dx, dy) > 8) {
        longPressCancelled = true
        cancelLongPress()
      }
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === longPressPointerId) {
        longPressCancelled = true
        cancelLongPress()
      }
    }
    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerup", onPointerEnd)
    canvas.addEventListener("pointercancel", onPointerEnd)

    map.on("click", (e) => {
      const savedPointFeatures = showSavedPointsRef.current
        ? map.queryRenderedFeatures(e.point, {
            layers: ["saved-points-hit-layer"],
          })
        : []
      if (savedPointFeatures.length > 0) {
        const id = savedPointFeatures[0].properties?.id
        if (id) onSavedPointSelectRef.current(id)
        const savedPoint = savedPointsRef.current.find(
          (point) => point.id === id
        )
        if (savedPoint) {
          map.easeTo({
            center: [savedPoint.lng, savedPoint.lat],
            zoom: Math.max(map.getZoom(), 10),
          })
        }
        return
      }
      const activityFeatures = map.queryRenderedFeatures(e.point, {
        layers: ["activities-hit-layer"],
      })
      if (activityFeatures.length > 0) {
        onActivitySelectRef.current?.(
          activityFeatures[0].properties?.id ?? null
        )
        return
      }
      if (map.getLayer("fog-layer")) {
        const fogFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["fog-layer"],
        })
        if (fogFeatures.length > 0) {
          onActivitySelectRef.current?.(null)
        }
      }
    })

    map.once("load", () => {
      map.resize()
      setupMapLayers(map, "flat")
      map.on("mouseenter", MAP_LAYER_IDS.activityHit, () => {
        map.getCanvas().style.cursor = "pointer"
      })
      map.on("mouseleave", MAP_LAYER_IDS.activityHit, () => {
        map.getCanvas().style.cursor = ""
      })
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
      cancelLongPress()
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerEnd)
      canvas.removeEventListener("pointercancel", onPointerEnd)
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
    if (!showSavedPoints) setSavedPointTooltip(null)
  }, [showSavedPoints])

  // Like photo markers, the tooltip is a MapLibre marker rather than an overlay
  // in the page. That keeps it attached to the saved point while the map moves.
  useEffect(() => {
    savedPointTooltipRootRef.current?.unmount()
    savedPointTooltipRootRef.current = null
    savedPointTooltipMarkerRef.current?.remove()
    savedPointTooltipMarkerRef.current = null

    const map = mapStore.map
    if (!map || !savedPointTooltip) return

    const element = document.createElement("div")
    element.style.pointerEvents = "none"
    const root = createRoot(element)
    root.render(<SavedPointTooltip name={savedPointTooltip.name} />)

    savedPointTooltipRootRef.current = root
    savedPointTooltipMarkerRef.current = new maplibregl.Marker({
      element,
      anchor: "bottom",
      offset: [0, -20],
    })
      .setLngLat(savedPointTooltip.lngLat)
      .addTo(map)

    return () => {
      root.unmount()
      savedPointTooltipMarkerRef.current?.remove()
      savedPointTooltipRootRef.current = null
      savedPointTooltipMarkerRef.current = null
    }
  }, [savedPointTooltip])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return
    setSavedPointsPresentation(map, savedPoints, showSavedPoints)
  }, [savedPoints, showSavedPoints, mapMode])

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
