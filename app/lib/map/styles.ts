import maplibregl, { type StyleSpecification } from "maplibre-gl"
import { Protocol } from "pmtiles"
import { MAP_STYLE_URL } from "~/constants/fog"
import type { MapMode } from "~/types/activities"

const pmtilesProtocol = new Protocol()
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol))

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    },
  },
  layers: [
    { id: "esri-satellite-layer", type: "raster", source: "esri-satellite" },
  ],
}

export function styleForMapMode(mode: MapMode): string | StyleSpecification {
  return mode === "relief" ? SATELLITE_STYLE : MAP_STYLE_URL
}
