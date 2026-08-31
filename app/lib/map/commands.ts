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
import { lapFeatureCollection } from "~/lib/map/geojson"
import { MAP_LAYER_IDS, MAP_SOURCE_IDS } from "~/lib/map/layers"
import type { ActivityCoords } from "~/types/activities"

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
