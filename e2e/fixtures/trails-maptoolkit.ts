import type { FeatureCollection, LineString } from "geojson"
import { GeoJSONVT } from "@maplibre/geojson-vt"
import { fromGeojsonVt } from "@maplibre/vt-pbf"
import type { Page, Request } from "@playwright/test"

export const MAPTOOLKIT_TILEJSON_URL =
  "https://tiles.maptoolkit.org/mtk.json"
export const MAPTOOLKIT_TILE_URL_PATTERN =
  "https://tiles.maptoolkit.org/e2e/mtk/{z}/{x}/{y}.mvt"
export const TRAIL_TEST_ZOOM = 12
export const TRAIL_TEST_CENTER: [number, number] = [14.42, 50.08]

export type TrailTileMode = "success" | "http" | "invalid" | "offline"

export interface TrailTileRequest {
  kind: "tilejson" | "tile"
  method: string
  status: number
  url: string
  authorization: string | null
  cookie: string | null
}

const trailFeatures: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        type: "path",
        subtype: "footway",
        walking_network: "nwn",
        network: "nwn",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [14.39, 50.065],
          [14.45, 50.095],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        type: "path",
        subtype: "cycleway",
        cycling_network: "lcn",
        network: "lcn",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [14.39, 50.095],
          [14.45, 50.065],
        ],
      },
    },
  ],
}

const tileIndex = new GeoJSONVT(trailFeatures, {
  maxZoom: 15,
  indexMaxZoom: 15,
  indexMaxPoints: 0,
  tolerance: 0,
  extent: 4096,
  buffer: 64,
})

function requestRecord(
  request: Request,
  kind: TrailTileRequest["kind"],
  status: number
): TrailTileRequest {
  const headers = request.headers()
  return {
    kind,
    method: request.method(),
    status,
    url: request.url(),
    authorization: headers.authorization ?? null,
    cookie: headers.cookie ?? null,
  }
}

function tileCoordinates(url: string): [number, number, number] | null {
  const match = /\/e2e\/mtk\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(
    new URL(url).pathname
  )
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export async function installTrailTiles(page: Page) {
  const requests: TrailTileRequest[] = []
  const state: { mode: TrailTileMode } = { mode: "success" }

  await page.route(MAPTOOLKIT_TILEJSON_URL, async (route) => {
    const request = route.request()
    if (state.mode === "offline") {
      requests.push(requestRecord(request, "tilejson", 0))
      await route.abort("failed")
      return
    }
    if (state.mode === "http") {
      requests.push(requestRecord(request, "tilejson", 503))
      await route.fulfill({ status: 503, body: "trail fixture unavailable" })
      return
    }

    requests.push(requestRecord(request, "tilejson", 200))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        tilejson: "3.0.0",
        name: "Maptoolkit E2E trails",
        minzoom: 0,
        maxzoom: 15,
        bounds: [-180, -85.0511287, 180, 85.0511287],
        attribution:
          "<a href='https://www.maptoolkit.com/copyright/'>&copy; Maptoolkit</a> <a href='https://www.openstreetmap.org/copyright'>&copy; Openstreetmap</a>",
        tiles: [MAPTOOLKIT_TILE_URL_PATTERN],
        vector_layers: [{ id: "road", minzoom: 4, maxzoom: 15 }],
      }),
    })
  })

  await page.route("https://tiles.maptoolkit.org/e2e/mtk/**", async (route) => {
    const request = route.request()
    if (state.mode === "offline") {
      requests.push(requestRecord(request, "tile", 0))
      await route.abort("failed")
      return
    }
    if (state.mode === "http") {
      requests.push(requestRecord(request, "tile", 503))
      await route.fulfill({ status: 503, body: "trail fixture unavailable" })
      return
    }

    const coordinates = tileCoordinates(request.url())
    if (!coordinates) {
      requests.push(requestRecord(request, "tile", 404))
      await route.fulfill({ status: 404 })
      return
    }
    const [z, x, y] = coordinates
    const tile = tileIndex.getTile(z, x, y)
    const encoded = tile
      ? Buffer.from(fromGeojsonVt({ road: tile as never }))
      : Buffer.alloc(0)
    const body = state.mode === "invalid" ? Buffer.from([0xff]) : encoded
    requests.push(requestRecord(request, "tile", 200))
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.mapbox-vector-tile",
      headers: { "Access-Control-Allow-Origin": "*" },
      body,
    })
  })

  return { requests, state }
}
