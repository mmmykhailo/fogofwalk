import { useEffect, useRef, useState, type RefObject } from "react"
import maplibregl from "maplibre-gl"
import { attachMapInteractions } from "~/components/map/mapInteractions"
import type { SavedPointTooltipState } from "~/components/map/useSavedPoints"
import {
  rehydrateMapPresentation,
  type MapPresentationState,
} from "~/lib/map/commands"
import { setupMapLayers } from "~/lib/map/layers"
import { mapStore, saveMapPosition } from "~/lib/mapStore"
import { styleForMapMode } from "~/lib/map/styles"
import type { MapMode } from "~/types/activities"

interface MapLifecycleOptions extends MapPresentationState {
  mapMode: MapMode
  onMapReady?: () => void
  onActivitySelect: (id: string | null) => void
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
  bearing: number
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
  const [bearing, setBearing] = useState(0)

  const currentPresentation = (): MapPresentationState => ({
    showActivities: optionsRef.current.showActivities,
    showFog: optionsRef.current.showFog,
    selectedActivityIds: optionsRef.current.selectedActivityIds,
    highlightCoordinates: optionsRef.current.highlightCoordinates,
    savedPoints: optionsRef.current.savedPoints,
    showSavedPoints: optionsRef.current.showSavedPoints,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapStore.map) return

    const initialMode = optionsRef.current.mapMode
    const map = new maplibregl.Map({
      container,
      style: styleForMapMode(initialMode),
      center: mapStore.initialCenter ?? [15, 50],
      zoom: mapStore.initialZoom ?? 5,
      minZoom: 5,
      pitch: initialMode === "relief" ? 45 : 0,
      attributionControl: { compact: false },
    })
    mapStore.map = map

    map.on("rotate", () => setBearing(map.getBearing()))
    map.on("moveend", () => {
      const center = map.getCenter()
      saveMapPosition([center.lng, center.lat], map.getZoom())
    })

    const detachMapInteractions = attachMapInteractions(map, {
      isShowingSavedPoints: () => optionsRef.current.showSavedPoints,
      getSavedPoints: () => optionsRef.current.savedPoints,
      onActivitySelect: (id) => optionsRef.current.onActivitySelect(id),
      onSavedPointSelect: (id) => optionsRef.current.onSavedPointSelect(id),
      onSavedPointCreate: (location) =>
        optionsRef.current.onSavedPointCreate?.(location),
      onSavedPointTooltipChange: (tooltip) =>
        optionsRef.current.onSavedPointTooltipChange(tooltip),
    })

    map.once("load", () => {
      map.resize()
      setupMapLayers(map, initialMode)
      rehydrateMapPresentation(map, currentPresentation())
      mapStore.sourcesReady = true
      isInitialStyleLoadedRef.current = true
      optionsRef.current.rebuildPhotoMarkers()
      optionsRef.current.onMapReady?.()
    })

    map.on("zoomend", () => optionsRef.current.rebuildPhotoMarkers())

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

  useEffect(() => {
    const map = mapStore.map
    if (!map || !isInitialStyleLoadedRef.current) return

    if (pendingStyleLoadRef.current) {
      map.off("style.load", pendingStyleLoadRef.current)
      pendingStyleLoadRef.current = null
    }
    mapStore.sourcesReady = false

    const onStyleLoad = () => {
      if (pendingStyleLoadRef.current !== onStyleLoad) return
      map.off("style.load", onStyleLoad)
      pendingStyleLoadRef.current = null

      setupMapLayers(map, options.mapMode)
      optionsRef.current.invalidateActivitiesCache()
      rehydrateMapPresentation(map, currentPresentation())
      map.easeTo({
        pitch: options.mapMode === "relief" ? 45 : 0,
        duration: 400,
      })
      mapStore.sourcesReady = true
      optionsRef.current.rebuildPhotoMarkers()
    }

    pendingStyleLoadRef.current = onStyleLoad
    map.on("style.load", onStyleLoad)
    map.setStyle(styleForMapMode(options.mapMode))
  }, [options.mapMode])

  return {
    containerRef,
    bearing,
    zoomIn: () => mapStore.map?.zoomIn(),
    zoomOut: () => mapStore.map?.zoomOut(),
    resetOrientation: () =>
      mapStore.map?.easeTo({ bearing: 0, pitch: 0, duration: 400 }),
  }
}
