import { geoJSONToTile } from "@maplibre/geojson-vt"
import { fromGeojsonVt } from "@maplibre/vt-pbf"

import type { TrailLineFeature } from "./geometry"

export const MVT_EXTENT = 4096

export function encodeMvtTile(
  features: TrailLineFeature[],
  zoom: number,
  x: number,
  y: number
): Uint8Array | null {
  const geojson = {
    type: "FeatureCollection" as const,
    features: features.map(({ wayId: _wayId, ...feature }) => feature),
  }
  const tile = geoJSONToTile(geojson, zoom, x, y, {
    extent: MVT_EXTENT,
    maxZoom: zoom,
    tolerance: 0,
    buffer: 64,
    clip: true,
    wrap: false,
  })
  if (!tile.features.length) return null
  const layers = { trails: tile } as unknown as Parameters<
    typeof fromGeojsonVt
  >[0]
  return fromGeojsonVt(layers, { version: 2, extent: MVT_EXTENT })
}
