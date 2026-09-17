import type {
  AddLayerObject,
  ExpressionSpecification,
  FilterSpecification,
  VectorSourceSpecification,
} from "maplibre-gl"
import type maplibregl from "maplibre-gl"
import { MaptoolkitLogoControl } from "@maptoolkit/maplibre-gl-logo"
import {
  ORDERED_TRAIL_LAYER_IDS,
  ORDERED_TRAIL_SOURCE_IDS,
  REVERSE_TRAIL_LAYER_IDS,
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_DASH_ARRAY,
  TRAIL_CYCLING_NETWORKS,
  TRAIL_CYCLING_OPACITY,
  TRAIL_CYCLING_WIDTH_STOPS,
  TRAIL_HIKING_CASING_COLOR,
  TRAIL_HIKING_CASING_OPACITY,
  TRAIL_HIKING_CASING_WIDTH_DELTA,
  TRAIL_HIKING_COLOR,
  TRAIL_HIKING_DASH_ARRAY,
  TRAIL_HIKING_OPACITY,
  TRAIL_HIKING_WIDTH_STOPS,
  TRAIL_LAYER_IDS,
  TRAIL_LINE_CAP,
  TRAIL_LINE_JOIN,
  TRAIL_MAX_RENDER_ZOOM,
  TRAIL_MIN_RENDER_ZOOM,
  TRAIL_SOURCE_ID,
  TRAIL_SOURCE_LAYER,
  TRAIL_TILEJSON_URL,
  TRAIL_WALKING_NETWORKS,
} from "~/constants/trails"
import { MAP_LAYER_IDS } from "~/lib/map/layers"

const logoControls = new WeakMap<maplibregl.Map, MaptoolkitLogoControl>()

function expression(value: unknown): ExpressionSpecification {
  return value as ExpressionSpecification
}

function widthExpression(
  stops: readonly number[],
  additiveWidth = 0
): ExpressionSpecification {
  const adjustedStops = stops.map((value, index) =>
    index % 2 === 0 ? value : value + additiveWidth
  )
  return expression(["interpolate", ["linear"], ["zoom"], ...adjustedStops])
}

function networkFilter(
  property: "walking_network" | "cycling_network",
  networks: readonly string[]
): FilterSpecification {
  return expression([
    "in",
    ["get", property],
    ["literal", networks],
  ]) as FilterSpecification
}

function sourceSpecification(): VectorSourceSpecification {
  return {
    type: "vector",
    url: TRAIL_TILEJSON_URL,
    maxzoom: 15,
  }
}

function hikingCasingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.hikingCasing,
    type: "line",
    source: TRAIL_SOURCE_ID,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: networkFilter("walking_network", TRAIL_WALKING_NETWORKS),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
    },
    paint: {
      "line-color": TRAIL_HIKING_CASING_COLOR,
      "line-opacity": TRAIL_HIKING_CASING_OPACITY,
      "line-width": widthExpression(
        TRAIL_HIKING_WIDTH_STOPS,
        TRAIL_HIKING_CASING_WIDTH_DELTA
      ),
    },
  }
}

function hikingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.hiking,
    type: "line",
    source: TRAIL_SOURCE_ID,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: networkFilter("walking_network", TRAIL_WALKING_NETWORKS),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
    },
    paint: {
      "line-color": TRAIL_HIKING_COLOR,
      "line-opacity": TRAIL_HIKING_OPACITY,
      "line-width": widthExpression(TRAIL_HIKING_WIDTH_STOPS),
      "line-dasharray": expression(["literal", TRAIL_HIKING_DASH_ARRAY]),
    },
  }
}

function cyclingLayer(): AddLayerObject {
  return {
    id: TRAIL_LAYER_IDS.cycling,
    type: "line",
    source: TRAIL_SOURCE_ID,
    "source-layer": TRAIL_SOURCE_LAYER,
    minzoom: TRAIL_MIN_RENDER_ZOOM,
    maxzoom: TRAIL_MAX_RENDER_ZOOM,
    filter: networkFilter("cycling_network", TRAIL_CYCLING_NETWORKS),
    layout: {
      "line-cap": TRAIL_LINE_CAP,
      "line-join": TRAIL_LINE_JOIN,
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
  if (!logoControls.has(map)) {
    const logoControl = new MaptoolkitLogoControl()
    map.addControl(logoControl)
    logoControls.set(map, logoControl)
  }
  if (!map.getSource(TRAIL_SOURCE_ID)) {
    map.addSource(TRAIL_SOURCE_ID, sourceSpecification())
  }

  const beforeId = trailInsertionPoint(map)
  const layers = [cyclingLayer(), hikingCasingLayer(), hikingLayer()]
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
  const logoControl = logoControls.get(map)
  if (logoControl) {
    map.removeControl(logoControl)
    logoControls.delete(map)
  }
}

export { ORDERED_TRAIL_LAYER_IDS }
