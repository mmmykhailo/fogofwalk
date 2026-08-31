import maplibregl, { type StyleSpecification } from "maplibre-gl"
import { Protocol } from "pmtiles"
import {
  MAP_STYLE_URL,
  MONOCHROME_BACKGROUND_COLOR,
} from "~/constants/fog"
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

export const MONOCHROME_STYLE: StyleSpecification = {
  version: 8,
  name: "Monochrome dark",
  sources: {},
  layers: [
    {
      id: "monochrome-background",
      type: "background",
      paint: {
        "background-color": MONOCHROME_BACKGROUND_COLOR,
      },
    },
  ],
}

export function styleForMapMode(mode: MapMode): string | StyleSpecification {
  if (mode === "relief") return SATELLITE_STYLE
  if (mode === "monochrome") return MONOCHROME_STYLE
  return MAP_STYLE_URL
}
