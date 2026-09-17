import type {
  AddLayerObject,
  ExpressionSpecification,
  FilterSpecification,
  VectorSourceSpecification,
} from "maplibre-gl"
import type maplibregl from "maplibre-gl"
import {
  ORDERED_TRAIL_LAYER_IDS,
  ORDERED_TRAIL_SOURCE_IDS,
  REVERSE_TRAIL_LAYER_IDS,
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_DASH_ARRAY,
  TRAIL_CYCLING_OPACITY,
  TRAIL_CYCLING_WIDTH_STOPS,
  TRAIL_DATA_ZOOM,
  TRAIL_HIKING_CASING_COLOR,
  TRAIL_HIKING_CASING_OPACITY,
  TRAIL_HIKING_CASING_WIDTH_DELTA,
  TRAIL_HIKING_OPACITY,
  TRAIL_HIKING_WIDTH_STOPS,
  TRAIL_INTERNAL_TILE_URLS,
  TRAIL_LAYER_IDS,
  TRAIL_LINE_CAP,
  TRAIL_LINE_JOIN,
  TRAIL_MAX_RENDER_ZOOM,
  TRAIL_MIN_RENDER_ZOOM,
  TRAIL_PROVIDER_ATTRIBUTION,
  TRAIL_SOURCE_IDS,
  TRAIL_SOURCE_LAYER,
  TRAIL_THEMES,
} from "~/constants/trails"
import { MAP_LAYER_IDS } from "~/lib/map/layers"

function expression(value: unknown): ExpressionSpecification {
  return value as ExpressionSpecification
}

function widthExpression(stops: readonly number[]): ExpressionSpecification {
  return expression(["interpolate", ["linear"], ["zoom"], ...stops])
}

function propertyExpression(name: string): ExpressionSpecification {
  return expression(["get", name])
}

function kindFilter(kind: (typeof TRAIL_THEMES)[number]): FilterSpecification {
  return expression(["==", ["get", "kind"], kind]) as FilterSpecification
}

function sourceSpecification(
  theme: (typeof TRAIL_THEMES)[number]
): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [TRAIL_INTERNAL_TILE_URLS[theme]],
    minzoom: TRAIL_DATA_ZOOM,
    maxzoom: TRAIL_DATA_ZOOM,
    attribution: TRAIL_PROVIDER_ATTRIBUTION,
  }
}

function hikingCasingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.hikingCasing,
    type: "line",
    source: TRAIL_SOURCE_IDS.hiking,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: kindFilter(TRAIL_THEMES[0]),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
      "line-sort-key": expression(["get", "sort"]),
    },
    paint: {
      "line-color": TRAIL_HIKING_CASING_COLOR,
      "line-opacity": TRAIL_HIKING_CASING_OPACITY,
      "line-offset": propertyExpression("offset"),
      "line-width": expression([
        "+",
        widthExpression(TRAIL_HIKING_WIDTH_STOPS),
        TRAIL_HIKING_CASING_WIDTH_DELTA,
      ]),
    },
  }
}

function hikingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.hiking,
    type: "line",
    source: TRAIL_SOURCE_IDS.hiking,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: kindFilter(TRAIL_THEMES[0]),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
      "line-sort-key": expression(["get", "sort"]),
    },
    paint: {
      "line-color": propertyExpression("color"),
      "line-opacity": TRAIL_HIKING_OPACITY,
      "line-offset": propertyExpression("offset"),
      "line-width": widthExpression(TRAIL_HIKING_WIDTH_STOPS),
    },
  }
}

function cyclingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.cycling,
    type: "line",
    source: TRAIL_SOURCE_IDS.cycling,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: kindFilter(TRAIL_THEMES[1]),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
      "line-sort-key": expression(["get", "sort"]),
    },
    paint: {
      "line-color": TRAIL_CYCLING_COLOR,
      "line-opacity": TRAIL_CYCLING_OPACITY,
      "line-width": widthExpression(TRAIL_CYCLING_WIDTH_STOPS),
      "line-dasharray": expression(["literal", TRAIL_CYCLING_DASH_ARRAY]),
    },
  }
}

export function trailInsertionPoint(map: maplibregl.Map): string | undefined {
  if (map.getLayer(MAP_LAYER_IDS.fog)) return MAP_LAYER_IDS.fog
  if (map.getLayer(MAP_LAYER_IDS.activities)) return MAP_LAYER_IDS.activities
  return undefined
}

export function ensureTrailLayers(map: maplibregl.Map): void {
  for (const theme of TRAIL_THEMES) {
    const sourceId = TRAIL_SOURCE_IDS[theme]
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, sourceSpecification(theme))
    }
  }

  const beforeId = trailInsertionPoint(map)
  const layers = [hikingCasingLayer(), hikingLayer(), cyclingLayer()]
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId)
  }
}

export function removeTrailLayers(map: maplibregl.Map): void {
  for (const layerId of REVERSE_TRAIL_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  for (const sourceId of ORDERED_TRAIL_SOURCE_IDS) {
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  }
}

export { ORDERED_TRAIL_LAYER_IDS }
