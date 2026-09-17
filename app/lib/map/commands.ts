import type maplibregl from "maplibre-gl"
import { TRAILS_FEATURE_ENABLED } from "~/constants/trails"
import {
  ACTIVITY_COLOR,
  ACTIVITY_COLOR_DIM,
  ACTIVITY_OPACITY_DEFAULT,
  ACTIVITY_OPACITY_DIM,
  ACTIVITY_OPACITY_SELECTED,
  ACTIVITY_WIDTH_DEFAULT,
  ACTIVITY_WIDTH_SELECTED,
} from "~/constants/fog"
import {
  activitiesFeatureCollection,
  lapFeatureCollection,
  savedPointsFeatureCollection,
} from "~/lib/map/geojson"
import {
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  SAVED_POINT_LAYER_IDS,
} from "~/lib/map/layers"
import { ensureTrailLayers, removeTrailLayers } from "~/lib/map/trails/layers"
import type { FogMaskLayer } from "~/lib/map/fogMaskLayer"
import type { ActivityCoords, ActivityPaths } from "~/types/activities"
import type { SavedPoint } from "~shared/saved-points"
import { mapStore, worldFogGeoJSON } from "~/lib/mapStore"
import { incrementPerformanceCounter } from "~/lib/performance"

export interface MapPresentationState {
  showActivities: boolean
  showTrails: boolean
  showFog: boolean
  selectedActivityIds: string[]
  highlightPaths: ActivityPaths | null
  savedPoints: SavedPoint[]
  showSavedPoints: boolean
}

function setLayerVisibility(
  map: maplibregl.Map,
  layerId: string,
  isVisible: boolean
): void {
  if (!map.getLayer(layerId)) return
  map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
}

export function setActivitiesVisible(
  map: maplibregl.Map,
  isVisible: boolean
): void {
  for (const layerId of [
    MAP_LAYER_IDS.activities,
    MAP_LAYER_IDS.activityHit,
    MAP_LAYER_IDS.lap,
  ]) {
    setLayerVisibility(map, layerId, isVisible)
  }
}

export function setFogVisible(map: maplibregl.Map, isVisible: boolean): void {
  setLayerVisibility(map, MAP_LAYER_IDS.fog, isVisible)
}

export function setTrailsEnabled(
  map: maplibregl.Map,
  isEnabled: boolean
): void {
  if (!TRAILS_FEATURE_ENABLED || !isEnabled) {
    removeTrailLayers(map)
    return
  }
  ensureTrailLayers(map)
}

/** Apply the latest accepted fog snapshot only after map sources are ready. */
export function applyFogDataToMap(
  map: maplibregl.Map,
  data = mapStore.fogData ?? worldFogGeoJSON(),
  revision = mapStore.fogData
    ? (mapStore.fogSnapshot?.coverageRevision ?? mapStore.coverageRevision)
    : null
): boolean {
  if (!mapStore.sourcesReady) return false
  const getLayer = (
    map as unknown as {
      getLayer?: (layerId: string) => unknown
    }
  ).getLayer
  const layer = getLayer?.call(map, MAP_LAYER_IDS.fog) as
    | (Partial<FogMaskLayer> & {
        implementation?: Partial<FogMaskLayer>
      })
    | undefined
  if (layer && typeof layer.setData === "function") {
    incrementPerformanceCounter("mapSourceSetDataCalls")
    layer.setData(data)
    mapStore.renderSourceRevision = revision
    return true
  }
  if (
    layer?.implementation &&
    typeof layer.implementation.setData === "function"
  ) {
    incrementPerformanceCounter("mapSourceSetDataCalls")
    layer.implementation.setData(data)
    mapStore.renderSourceRevision = revision
    return true
  }
  const source = map.getSource(MAP_SOURCE_IDS.fog) as
    | maplibregl.GeoJSONSource
    | undefined
  if (!source) return false
  incrementPerformanceCounter("mapSourceSetDataCalls")
  source.setData(data)
  mapStore.renderSourceRevision = revision
  return true
}

export function setSavedPointsPresentation(
  map: maplibregl.Map,
  savedPoints: SavedPoint[],
  isVisible: boolean
): void {
  const source = map.getSource(MAP_SOURCE_IDS.savedPoints) as
    | maplibregl.GeoJSONSource
    | undefined
  if (source) {
    incrementPerformanceCounter("mapSourceSetDataCalls")
    source.setData(savedPointsFeatureCollection(savedPoints))
  }
  for (const layerId of SAVED_POINT_LAYER_IDS) {
    setLayerVisibility(map, layerId, isVisible)
  }
}

export function applyActivitySelectionPaint(
  map: maplibregl.Map,
  selectedActivityIds: string[],
  isLapActive: boolean
): void {
  incrementPerformanceCounter("activityPaintUpdates")
  if (selectedActivityIds.length === 0) {
    map.setPaintProperty(
      MAP_LAYER_IDS.activities,
      "line-width",
      ACTIVITY_WIDTH_DEFAULT
    )
    map.setPaintProperty(
      MAP_LAYER_IDS.activities,
      "line-opacity",
      ACTIVITY_OPACITY_DEFAULT
    )
    map.setPaintProperty(MAP_LAYER_IDS.activities, "line-color", ACTIVITY_COLOR)
    return
  }

  const selectionExpr = ["in", ["get", "id"], ["literal", selectedActivityIds]]
  map.setPaintProperty(MAP_LAYER_IDS.activities, "line-width", [
    "case",
    selectionExpr,
    ACTIVITY_WIDTH_SELECTED,
    ACTIVITY_WIDTH_DEFAULT,
  ])
  map.setPaintProperty(MAP_LAYER_IDS.activities, "line-opacity", [
    "case",
    selectionExpr,
    ACTIVITY_OPACITY_SELECTED,
    ACTIVITY_OPACITY_DIM,
  ])
  map.setPaintProperty(
    MAP_LAYER_IDS.activities,
    "line-color",
    isLapActive
      ? ACTIVITY_COLOR_DIM
      : ["case", selectionExpr, ACTIVITY_COLOR, ACTIVITY_COLOR_DIM]
  )
}

export function setLapHighlightData(
  map: maplibregl.Map,
  paths: ActivityCoords | ActivityPaths | null
): void {
  const source = map.getSource(MAP_SOURCE_IDS.lap) as
    | maplibregl.GeoJSONSource
    | undefined
  if (source) {
    incrementPerformanceCounter("mapSourceSetDataCalls")
    source.setData(lapFeatureCollection(paths as ActivityPaths | null))
  }
}

/** Restores everything setStyle removes before sourcesReady becomes true. */
export function rehydrateMapPresentation(
  map: maplibregl.Map,
  state: MapPresentationState
): void {
  setTrailsEnabled(map, state.showTrails)
  setSavedPointsPresentation(map, state.savedPoints, state.showSavedPoints)
  setActivitiesVisible(map, state.showActivities)
  setLapHighlightData(map, state.highlightPaths)
  setFogVisible(map, state.showFog)
  applyActivitySelectionPaint(
    map,
    state.selectedActivityIds,
    state.highlightPaths != null
  )
}

/** Clears activity-derived rendering without exposing source ids to route code. */
export function clearRenderedActivityState(): void {
  const map = mapStore.map
  if (!map || !mapStore.sourcesReady) return

  applyFogDataToMap(map, worldFogGeoJSON(), null)

  const activitiesSource = map.getSource(MAP_SOURCE_IDS.activities) as
    | maplibregl.GeoJSONSource
    | undefined
  if (activitiesSource) {
    incrementPerformanceCounter("mapSourceSetDataCalls")
    activitiesSource.setData(activitiesFeatureCollection([]))
  }
  setLapHighlightData(map, null)
}
