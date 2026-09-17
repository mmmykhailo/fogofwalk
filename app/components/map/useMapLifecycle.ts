import { useEffect, useRef, useState, type RefObject } from "react"
import maplibregl from "maplibre-gl"
import { attachMapInteractions } from "~/components/map/mapInteractions"
import type { SavedPointTooltipState } from "~/components/map/useSavedPoints"
import {
  applyFogDataToMap,
  rehydrateMapPresentation,
  type MapPresentationState,
} from "~/lib/map/commands"
import { activitiesFeatureCollection } from "~/lib/map/geojson"
import { MAP_SOURCE_IDS, setupMapLayers } from "~/lib/map/layers"
import { mapStore, saveMapPosition } from "~/lib/mapStore"
import { styleForMapMode } from "~/lib/map/styles"
import { incrementPerformanceCounter } from "~/lib/performance"
import type { MapMode } from "~/types/activities"
import { TRAIL_SOURCE_ID } from "~/constants/trails"
import { removeTrailLayers } from "~/lib/map/trails/layers"
import { recordTrailTileError } from "~/lib/map/trails/diagnostics"

declare global {
  interface Window {
    __fogofwalkE2eMap?: maplibregl.Map
  }
}

interface MapLifecycleOptions extends MapPresentationState {
  mapMode: MapMode
  onMapReady?: () => void
  onActivitySelect: (id: string | null) => void
  onMapBackgroundClick: () => void
  onSavedPointSelect: (id: string) => void
  onSavedPointCreate?: (location: {
    lng: number
    lat: number
    point: { x: number; y: number }
  }) => void
  onSavedPointTooltipChange: (tooltip: SavedPointTooltipState | null) => void
  invalidateActivitiesCache: () => void
  rebuildPhotoMarkers: () => void
}

interface MapLifecycleResult {
  containerRef: RefObject<HTMLDivElement | null>
  map: maplibregl.Map | null
  zoomIn: () => void
  zoomOut: () => void
  resetOrientation: () => void
}

export function useMapLifecycle(
  options: MapLifecycleOptions
): MapLifecycleResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const pendingStyleLoadRef = useRef<(() => void) | null>(null)
  const isInitialStyleLoadedRef = useRef(false)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)

  const currentPresentation = (): MapPresentationState => ({
    showActivities: optionsRef.current.showActivities,
    showTrails: optionsRef.current.showTrails,
    showFog: optionsRef.current.showFog,
    selectedActivityIds: optionsRef.current.selectedActivityIds,
    highlightPaths: optionsRef.current.highlightPaths,
    savedPoints: optionsRef.current.savedPoints,
    showSavedPoints: optionsRef.current.showSavedPoints,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapStore.map) return
    let disposed = false

    const initialMode = optionsRef.current.mapMode
    const map = new maplibregl.Map({
      container,
      style: styleForMapMode(initialMode),
      center: mapStore.initialCenter ?? [15, 50],
      zoom: mapStore.initialZoom ?? 5,
      minZoom: 5,
      pitch: initialMode === "relief" ? 45 : 0,
      canvasContextAttributes: {
        preserveDrawingBuffer: import.meta.env.VITE_E2E === "1",
      },
      attributionControl: { compact: false },
    })
    mapStore.map = map
    setMapInstance(map)
    if (import.meta.env.VITE_E2E === "1") {
      window.__fogofwalkE2eMap = map
    }
    const mapSurface =
      container.closest<HTMLElement>("[data-map-cache]") ?? container

    const rehydrateAfterContextRestore = () => {
      if (disposed) return
      setupMapLayers(map, optionsRef.current.mapMode, {
        showTrails: currentPresentation().showTrails,
      })
      mapStore.sourcesReady = true
      const activitiesSource = map.getSource(MAP_SOURCE_IDS.activities) as
        | maplibregl.GeoJSONSource
        | undefined
      if (activitiesSource) {
        incrementPerformanceCounter("mapSourceSetDataCalls")
        activitiesSource.setData(
          activitiesFeatureCollection(mapStore.activities)
        )
      }
      optionsRef.current.invalidateActivitiesCache()
      rehydrateMapPresentation(
        map,
        currentPresentation(),
        "webgl-context-restoration"
      )
      applyFogDataToMap(map)
      isInitialStyleLoadedRef.current = true
      optionsRef.current.rebuildPhotoMarkers()
    }

    const waitForContextStyle = () => {
      const pending = pendingStyleLoadRef.current
      if (pending) map.off("style.load", pending)
      pendingStyleLoadRef.current = null

      const onStyleLoad = () => {
        if (pendingStyleLoadRef.current !== onStyleLoad) return
        map.off("style.load", onStyleLoad)
        pendingStyleLoadRef.current = null
        rehydrateAfterContextRestore()
      }
      pendingStyleLoadRef.current = onStyleLoad
      map.on("style.load", onStyleLoad)
      // Context restoration may have completed the style before MapLibre emits
      // its restoration event. In that case the event has already been missed,
      // but the style readiness check still lets us re-add the custom layer.
      if (map.isStyleLoaded()) onStyleLoad()
    }

    const handleContextLost = () => {
      mapStore.sourcesReady = false
      mapStore.renderSourceRevision = null
    }
    const handleContextRestored = () => {
      mapStore.sourcesReady = false
      mapStore.renderSourceRevision = null
      waitForContextStyle()
    }
    map.on("webglcontextlost", handleContextLost)
    map.on("webglcontextrestored", handleContextRestored)

    const handleMapError = (event: unknown) => {
      const sourceId =
        event && typeof event === "object" && "sourceId" in event
          ? (event as { sourceId?: unknown }).sourceId
          : undefined
      if (sourceId === TRAIL_SOURCE_ID) recordTrailTileError(event)
    }
    map.on("error", handleMapError as never)

    const handleMoveStart = () => {
      mapSurface.dataset.mapMoving = ""
    }
    const handleMoveEnd = () => {
      delete mapSurface.dataset.mapMoving
      const center = map.getCenter()
      saveMapPosition([center.lng, center.lat], map.getZoom())
    }
    const handleMapRemove = () => {
      delete mapSurface.dataset.mapMoving
    }
    map.on("movestart", handleMoveStart)
    map.on("moveend", handleMoveEnd)
    map.on("remove", handleMapRemove)

    const detachMapInteractions = attachMapInteractions(map, {
      isShowingSavedPoints: () => optionsRef.current.showSavedPoints,
      getSavedPoints: () => optionsRef.current.savedPoints,
      onActivitySelect: (id) => optionsRef.current.onActivitySelect(id),
      onMapBackgroundClick: () => optionsRef.current.onMapBackgroundClick(),
      onSavedPointSelect: (id) => optionsRef.current.onSavedPointSelect(id),
      onSavedPointCreate: (location) =>
        optionsRef.current.onSavedPointCreate?.(location),
      onSavedPointTooltipChange: (tooltip) =>
        optionsRef.current.onSavedPointTooltipChange(tooltip),
    })

    map.once("load", () => {
      map.resize()
      setupMapLayers(map, initialMode, {
        showTrails: currentPresentation().showTrails,
      })
      mapStore.sourcesReady = true
      rehydrateMapPresentation(map, currentPresentation(), "initial-load")
      applyFogDataToMap(map)
      isInitialStyleLoadedRef.current = true
      optionsRef.current.rebuildPhotoMarkers()
      optionsRef.current.onMapReady?.()
    })

    map.on("zoomend", () => optionsRef.current.rebuildPhotoMarkers())

    return () => {
      disposed = true
      detachMapInteractions()
      map.off("webglcontextlost", handleContextLost)
      map.off("webglcontextrestored", handleContextRestored)
      map.off("error", handleMapError as never)
      map.off("movestart", handleMoveStart)
      map.off("moveend", handleMoveEnd)
      map.off("remove", handleMapRemove)
      delete mapSurface.dataset.mapMoving
      removeTrailLayers(map)
      mapStore.sourcesReady = false
      mapStore.renderSourceRevision = null
      mapStore.map = null
      setMapInstance(null)
      if (window.__fogofwalkE2eMap === map) {
        delete window.__fogofwalkE2eMap
      }
      if (pendingStyleLoadRef.current) {
        map.off("style.load", pendingStyleLoadRef.current)
        pendingStyleLoadRef.current = null
      }
      map.remove()
    }
  }, [])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !isInitialStyleLoadedRef.current) return

    if (pendingStyleLoadRef.current) {
      map.off("style.load", pendingStyleLoadRef.current)
      pendingStyleLoadRef.current = null
    }
    mapStore.sourcesReady = false
    mapStore.renderSourceRevision = null

    const onStyleLoad = () => {
      if (pendingStyleLoadRef.current !== onStyleLoad) return
      map.off("style.load", onStyleLoad)
      pendingStyleLoadRef.current = null

      setupMapLayers(map, options.mapMode, {
        showTrails: currentPresentation().showTrails,
      })
      mapStore.sourcesReady = true
      optionsRef.current.invalidateActivitiesCache()
      rehydrateMapPresentation(map, currentPresentation(), "style-reload")
      applyFogDataToMap(map)
      map.easeTo({
        pitch: options.mapMode === "relief" ? 45 : 0,
        duration: 400,
      })
      optionsRef.current.rebuildPhotoMarkers()
    }

    pendingStyleLoadRef.current = onStyleLoad
    map.on("style.load", onStyleLoad)
    map.setStyle(styleForMapMode(options.mapMode))
  }, [options.mapMode])

  return {
    containerRef,
    map: mapInstance,
    zoomIn: () => mapStore.map?.zoomIn(),
    zoomOut: () => mapStore.map?.zoomOut(),
    resetOrientation: () =>
      mapStore.map?.easeTo({ bearing: 0, pitch: 0, duration: 400 }),
  }
}
