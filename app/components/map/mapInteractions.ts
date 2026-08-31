import maplibregl from "maplibre-gl"
import { MAP_LAYER_IDS } from "~/lib/map/layers"
import type { SavedPoint } from "~shared/saved-points"
import type { SavedPointTooltipState } from "~/components/map/useSavedPoints"

export interface SavedPointCreateLocation {
  lng: number
  lat: number
  point: { x: number; y: number }
}

interface MapInteractionOptions {
  isShowingSavedPoints: () => boolean
  getSavedPoints: () => SavedPoint[]
  onActivitySelect: (id: string | null) => void
  onSavedPointSelect: (id: string) => void
  onSavedPointCreate?: (location: SavedPointCreateLocation) => void
  onSavedPointTooltipChange: (tooltip: SavedPointTooltipState | null) => void
}

/** Installs the map's pointer interactions once and returns their cleanup. */
export function attachMapInteractions(
  map: maplibregl.Map,
  options: MapInteractionOptions
): () => void {
  const isSavedPointGesture = (point: maplibregl.Point) =>
    options.isShowingSavedPoints() &&
    map.queryRenderedFeatures(point, { layers: [MAP_LAYER_IDS.savedPointHit] })
      .length > 0
  const isProtectedCreateGesture = (point: maplibregl.Point) =>
    isSavedPointGesture(point) ||
    map.queryRenderedFeatures(point, { layers: [MAP_LAYER_IDS.activityHit] })
      .length > 0
  const createSavedPoint = (
    lngLat: maplibregl.LngLat,
    point: maplibregl.Point
  ) => {
    options.onSavedPointCreate?.({
      lng: lngLat.lng,
      lat: lngLat.lat,
      point: { x: point.x, y: point.y },
    })
  }

  const onActivityEnter = () => {
    map.getCanvas().style.cursor = "pointer"
  }
  const onActivityLeave = () => {
    map.getCanvas().style.cursor = ""
  }
  let hoveredSavedPointId: string | null = null
  const updateSavedPointTooltip = (event: maplibregl.MapLayerMouseEvent) => {
    if (!options.isShowingSavedPoints()) return
    const feature = event.features?.[0]
    const id = feature?.properties?.id
    const name = feature?.properties?.name
    const coordinates =
      feature?.geometry.type === "Point" ? feature.geometry.coordinates : null
    if (
      typeof id !== "string" ||
      !id ||
      typeof name !== "string" ||
      !name ||
      !coordinates ||
      typeof coordinates[0] !== "number" ||
      typeof coordinates[1] !== "number"
    )
      return
    if (id === hoveredSavedPointId) return
    hoveredSavedPointId = id
    options.onSavedPointTooltipChange({
      name,
      lngLat: [coordinates[0], coordinates[1]],
    })
  }
  const onSavedPointEnter = (event: maplibregl.MapLayerMouseEvent) => {
    map.getCanvas().style.cursor = "pointer"
    updateSavedPointTooltip(event)
  }
  const onSavedPointLeave = () => {
    map.getCanvas().style.cursor = ""
    hoveredSavedPointId = null
    options.onSavedPointTooltipChange(null)
  }
  const onContextMenu = (event: maplibregl.MapMouseEvent) => {
    event.preventDefault()
    if (!isProtectedCreateGesture(event.point)) {
      createSavedPoint(event.lngLat, event.point)
    }
  }
  const onClick = (event: maplibregl.MapMouseEvent) => {
    const savedPointFeatures = options.isShowingSavedPoints()
      ? map.queryRenderedFeatures(event.point, {
          layers: [MAP_LAYER_IDS.savedPointHit],
        })
      : []
    if (savedPointFeatures.length > 0) {
      const id = savedPointFeatures[0].properties?.id
      if (id) options.onSavedPointSelect(id)
      const savedPoint = options
        .getSavedPoints()
        .find((point) => point.id === id)
      if (savedPoint) {
        map.easeTo({
          center: [savedPoint.lng, savedPoint.lat],
          zoom: Math.max(map.getZoom(), 10),
        })
      }
      return
    }

    const activityFeatures = map.queryRenderedFeatures(event.point, {
      layers: [MAP_LAYER_IDS.activityHit],
    })
    if (activityFeatures.length > 0) {
      options.onActivitySelect(activityFeatures[0].properties?.id ?? null)
      return
    }

    if (!map.getLayer(MAP_LAYER_IDS.fog)) return
    const fogFeatures = map.queryRenderedFeatures(event.point, {
      layers: [MAP_LAYER_IDS.fog],
    })
    if (fogFeatures.length > 0) options.onActivitySelect(null)
  }

  map.on("mouseenter", MAP_LAYER_IDS.activityHit, onActivityEnter)
  map.on("mouseleave", MAP_LAYER_IDS.activityHit, onActivityLeave)
  map.on("mouseenter", MAP_LAYER_IDS.savedPointHit, onSavedPointEnter)
  map.on("mousemove", MAP_LAYER_IDS.savedPointHit, updateSavedPointTooltip)
  map.on("mouseleave", MAP_LAYER_IDS.savedPointHit, onSavedPointLeave)
  map.on("contextmenu", onContextMenu)
  map.on("click", onClick)

  const canvas = map.getCanvas()
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressPointerId: number | null = null
  let longPressStart: maplibregl.Point | null = null
  let isLongPressCancelled = false
  const cancelLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
    longPressPointerId = null
    longPressStart = null
  }
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return
    if (!event.isPrimary) {
      isLongPressCancelled = true
      cancelLongPress()
      return
    }
    if (longPressTimer) return
    const bounds = canvas.getBoundingClientRect()
    const point = new maplibregl.Point(
      event.clientX - bounds.left,
      event.clientY - bounds.top
    )
    if (
      (event.target as Element | null)?.closest(".maplibregl-marker") ||
      isProtectedCreateGesture(point)
    )
      return
    longPressPointerId = event.pointerId
    longPressStart = point
    isLongPressCancelled = false
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      if (!isLongPressCancelled && longPressStart) {
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
      isLongPressCancelled = true
      cancelLongPress()
    }
  }
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === longPressPointerId) {
      isLongPressCancelled = true
      cancelLongPress()
    }
  }
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointermove", onPointerMove)
  canvas.addEventListener("pointerup", onPointerEnd)
  canvas.addEventListener("pointercancel", onPointerEnd)

  return () => {
    cancelLongPress()
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener("pointermove", onPointerMove)
    canvas.removeEventListener("pointerup", onPointerEnd)
    canvas.removeEventListener("pointercancel", onPointerEnd)
    map.off("mouseenter", MAP_LAYER_IDS.activityHit, onActivityEnter)
    map.off("mouseleave", MAP_LAYER_IDS.activityHit, onActivityLeave)
    map.off("mouseenter", MAP_LAYER_IDS.savedPointHit, onSavedPointEnter)
    map.off("mousemove", MAP_LAYER_IDS.savedPointHit, updateSavedPointTooltip)
    map.off("mouseleave", MAP_LAYER_IDS.savedPointHit, onSavedPointLeave)
    map.off("contextmenu", onContextMenu)
    map.off("click", onClick)
  }
}
