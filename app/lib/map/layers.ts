import type maplibregl from "maplibre-gl"
import {
  ACTIVITY_COLOR,
  ACTIVITY_HIT_WIDTH,
  ACTIVITY_OPACITY_DEFAULT,
  ACTIVITY_WIDTH_DEFAULT,
  LAP_HIGHLIGHT_WIDTH,
} from "~/constants/fog"
import { mapStore, worldFogGeoJSON } from "~/lib/mapStore"
import { activitiesFeatureCollection } from "~/lib/map/geojson"
import { createFogMaskLayer } from "~/lib/map/fogMaskLayer"
import type { MapMode } from "~/types/activities"

export const MAP_SOURCE_IDS = {
  fog: "fog-source",
  activities: "activities-source",
  savedPoints: "saved-points-source",
  lap: "lap-source",
} as const

export const MAP_LAYER_IDS = {
  fog: "fog-layer",
  activities: "activities-layer",
  activityHit: "activities-hit-layer",
  savedPointOuter: "saved-points-outer-layer",
  savedPointCentre: "saved-points-centre-layer",
  savedPointHit: "saved-points-hit-layer",
  lap: "lap-layer",
} as const

export const SAVED_POINT_LAYER_IDS = [
  MAP_LAYER_IDS.savedPointOuter,
  MAP_LAYER_IDS.savedPointCentre,
  MAP_LAYER_IDS.savedPointHit,
] as const

export function setupMapLayers(map: maplibregl.Map, mode: MapMode): void {
  if (mode === "relief") {
    if (!map.getSource("terrain-source")) {
      map.addSource("terrain-source", {
        type: "raster-dem",
        tiles: [
          "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
        ],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 14,
      })
    }
    map.setTerrain({ source: "terrain-source", exaggeration: 2.5 })
  }

  if (mode !== "relief" && !map.getLayer(MAP_LAYER_IDS.fog)) {
    map.addLayer(createFogMaskLayer(mapStore.fogData ?? worldFogGeoJSON()))
  }

  if (!map.getSource(MAP_SOURCE_IDS.activities)) {
    map.addSource(MAP_SOURCE_IDS.activities, {
      type: "geojson",
      data: activitiesFeatureCollection(mapStore.activities),
    })
  }
  if (!map.getLayer(MAP_LAYER_IDS.activities)) {
    map.addLayer({
      id: MAP_LAYER_IDS.activities,
      type: "line",
      source: MAP_SOURCE_IDS.activities,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "visible",
      },
      paint: {
        "line-color": ACTIVITY_COLOR,
        "line-width": ACTIVITY_WIDTH_DEFAULT,
        "line-opacity": ACTIVITY_OPACITY_DEFAULT,
      },
    })
  }

  if (!map.getSource(MAP_SOURCE_IDS.savedPoints)) {
    map.addSource(MAP_SOURCE_IDS.savedPoints, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    })
  }
  if (!map.getLayer(MAP_LAYER_IDS.savedPointOuter)) {
    map.addLayer({
      id: MAP_LAYER_IDS.savedPointOuter,
      type: "circle",
      source: MAP_SOURCE_IDS.savedPoints,
      paint: {
        "circle-radius": 10,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#fff",
      },
    })
  }
  if (!map.getLayer(MAP_LAYER_IDS.savedPointCentre)) {
    map.addLayer({
      id: MAP_LAYER_IDS.savedPointCentre,
      type: "circle",
      source: MAP_SOURCE_IDS.savedPoints,
      paint: { "circle-radius": 3.5, "circle-color": "#fff" },
    })
  }
  // Kept as a source layer (rather than a DOM marker) so taps have a forgiving
  // target without making the visible point itself oversized.
  if (!map.getLayer(MAP_LAYER_IDS.savedPointHit)) {
    map.addLayer({
      id: MAP_LAYER_IDS.savedPointHit,
      type: "circle",
      source: MAP_SOURCE_IDS.savedPoints,
      paint: {
        "circle-radius": 22,
        "circle-color": "#000",
        "circle-opacity": 0,
      },
    })
  }
  // Invisible wide line for hit-testing only — the visible line stays thin.
  if (!map.getLayer(MAP_LAYER_IDS.activityHit)) {
    map.addLayer({
      id: MAP_LAYER_IDS.activityHit,
      type: "line",
      source: MAP_SOURCE_IDS.activities,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "visible",
      },
      paint: {
        "line-color": ACTIVITY_COLOR,
        "line-width": ACTIVITY_HIT_WIDTH,
        "line-opacity": 0,
      },
    })
  }

  if (!map.getSource(MAP_SOURCE_IDS.lap)) {
    map.addSource(MAP_SOURCE_IDS.lap, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    })
  }
  if (!map.getLayer(MAP_LAYER_IDS.lap)) {
    map.addLayer({
      id: MAP_LAYER_IDS.lap,
      type: "line",
      source: MAP_SOURCE_IDS.lap,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "visible",
      },
      paint: {
        "line-color": ACTIVITY_COLOR,
        "line-width": LAP_HIGHLIGHT_WIDTH,
        "line-opacity": 1,
      },
    })
  }
}
