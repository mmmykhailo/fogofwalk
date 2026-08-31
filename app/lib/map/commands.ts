import type maplibregl from "maplibre-gl"
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
import type { ActivityCoords } from "~/types/activities"
import type { SavedPoint } from "~shared/saved-points"
import { mapStore, worldFogGeoJSON } from "~/lib/mapStore"

export interface MapPresentationState {
  showActivities: boolean
  showFog: boolean
  selectedActivityIds: string[]
  highlightCoordinates: ActivityCoords | null
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

export function setSavedPointsPresentation(
  map: maplibregl.Map,
  savedPoints: SavedPoint[],
  isVisible: boolean
): void {
  const source = map.getSource(MAP_SOURCE_IDS.savedPoints) as
    | maplibregl.GeoJSONSource
    | undefined
  source?.setData(savedPointsFeatureCollection(savedPoints))
  for (const layerId of SAVED_POINT_LAYER_IDS) {
    setLayerVisibility(map, layerId, isVisible)
  }
}

export function applyActivitySelectionPaint(
  map: maplibregl.Map,
  selectedActivityIds: string[],
  isLapActive: boolean
): void {
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
  coordinates: ActivityCoords | null
): void {
  const source = map.getSource(MAP_SOURCE_IDS.lap) as
    | maplibregl.GeoJSONSource
    | undefined
  source?.setData(lapFeatureCollection(coordinates))
}

/** Restores everything setStyle removes before sourcesReady becomes true. */
export function rehydrateMapPresentation(
  map: maplibregl.Map,
  state: MapPresentationState
): void {
  setSavedPointsPresentation(map, state.savedPoints, state.showSavedPoints)
  setActivitiesVisible(map, state.showActivities)
  setLapHighlightData(map, state.highlightCoordinates)
  setFogVisible(map, state.showFog)
  applyActivitySelectionPaint(
    map,
    state.selectedActivityIds,
    state.highlightCoordinates != null
  )
}

/** Clears activity-derived rendering without exposing source ids to route code. */
export function clearRenderedActivityState(): void {
  const map = mapStore.map
  if (!map || !mapStore.sourcesReady) return

  const fogSource = map.getSource(MAP_SOURCE_IDS.fog) as
    | maplibregl.GeoJSONSource
    | undefined
  fogSource?.setData(worldFogGeoJSON())

  const activitiesSource = map.getSource(MAP_SOURCE_IDS.activities) as
    | maplibregl.GeoJSONSource
    | undefined
  activitiesSource?.setData(activitiesFeatureCollection([]))
  setLapHighlightData(map, null)
}
