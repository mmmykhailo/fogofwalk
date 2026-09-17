import type { FeatureCollection, LineString, MultiLineString } from "geojson"
import { geoJSONToTile, type GeoJSONVTTile } from "@maplibre/geojson-vt"
import { fromGeojsonVt } from "@maplibre/vt-pbf"
import { TRAIL_DATA_ZOOM, TRAIL_SOURCE_LAYER } from "~/constants/trails"
import type {
  NormalizedTrailTile,
  RenderTrailProperties,
  TrailTileCoordinate,
} from "~/lib/map/trails/types"

const EMPTY_COLLECTION: FeatureCollection<
  LineString | MultiLineString,
  RenderTrailProperties
> = {
  type: "FeatureCollection",
  features: [],
}

type VtPbfTile = Parameters<typeof fromGeojsonVt>[0][string]

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function emptyGeojsonVtTile(): GeoJSONVTTile {
  return geoJSONToTile(EMPTY_COLLECTION, TRAIL_DATA_ZOOM, 0, 0, {
    maxZoom: TRAIL_DATA_ZOOM,
  })
}

const EMPTY_TRAIL_TILE_BYTES = fromGeojsonVt({
  [TRAIL_SOURCE_LAYER]: emptyGeojsonVtTile() as unknown as VtPbfTile,
})

export function encodeTrailTile(
  normalized: NormalizedTrailTile,
  coordinate: TrailTileCoordinate
): ArrayBuffer {
  const tile = geoJSONToTile(
    normalized.collection,
    coordinate.z,
    coordinate.x,
    coordinate.y,
    { maxZoom: coordinate.z }
  )
  return ownedArrayBuffer(
    fromGeojsonVt({
      [TRAIL_SOURCE_LAYER]: tile as unknown as VtPbfTile,
    })
  )
}

export function createEmptyTrailTile(): ArrayBuffer {
  return ownedArrayBuffer(EMPTY_TRAIL_TILE_BYTES)
}
