import maplibregl, { type MapGeoJSONFeature } from "maplibre-gl"
import { MAP_LAYER_IDS } from "~/lib/map/layers"

/** Ordered from the highest-priority interactive map layer to the lowest. */
export const INTERACTIVE_TARGET_LAYER_IDS = [
  MAP_LAYER_IDS.savedPointHit,
  MAP_LAYER_IDS.activityHit,
] as const

/** Attribute used by DOM-backed map features that should protect map clicks. */
export const MAP_INTERACTIVE_ATTRIBUTE = "data-map-interactive"
export const MAP_INTERACTIVE_SELECTOR = `[${MAP_INTERACTIVE_ATTRIBUTE}]`

/**
 * Returns only the registered layers that are currently installed in the map
 * style. A style replacement briefly removes custom layers, so callers must
 * not query a layer until this check has passed.
 */
export function getInstalledInteractiveLayerIds(
  map: Pick<maplibregl.Map, "getLayer">,
  layerIds: readonly string[] = INTERACTIVE_TARGET_LAYER_IDS
): string[] {
  return layerIds.filter((layerId) => {
    try {
      return Boolean(map.getLayer(layerId))
    } catch {
      return false
    }
  })
}

/** Queries all installed interactive layers while preserving registry order. */
export function queryInteractiveFeatures(
  map: Pick<maplibregl.Map, "getLayer" | "queryRenderedFeatures">,
  point: maplibregl.PointLike,
  layerIds: readonly string[] = INTERACTIVE_TARGET_LAYER_IDS
): MapGeoJSONFeature[] {
  const installedLayerIds = getInstalledInteractiveLayerIds(map, layerIds)
  if (installedLayerIds.length === 0) return []

  let features: MapGeoJSONFeature[]
  try {
    features = map.queryRenderedFeatures(point, {
      layers: installedLayerIds,
    })
  } catch {
    return []
  }

  const order = new Map(
    installedLayerIds.map((layerId, index) => [layerId, index])
  )
  return features
    .map((feature, index) => ({
      feature,
      index,
      layerIndex: order.get(feature.layer.id),
    }))
    .filter(
      (item): item is typeof item & { layerIndex: number } =>
        item.layerIndex != null
    )
    .sort((a, b) => a.layerIndex - b.layerIndex || a.index - b.index)
    .map(({ feature }) => feature)
}

/** Returns true when a map event target is inside a registered DOM marker. */
export function isInteractiveDomTarget(
  target: EventTarget | null | undefined
): boolean {
  if (!target) return false
  const closest = (target as { closest?: unknown }).closest
  if (typeof closest !== "function") return false
  return Boolean(closest.call(target, MAP_INTERACTIVE_SELECTOR))
}
