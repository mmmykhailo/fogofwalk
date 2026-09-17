import { describe, expect, test } from "bun:test"
import { isMapStyleRequest, isMapTileRequest } from "./swRouting"

function request(url: string): { url: URL } {
  return { url: new URL(url) }
}

describe("service worker map resource routing", () => {
  test("caches production OpenFreeMap tiles but not glyph PBFs", () => {
    expect(
      isMapTileRequest(
        request(
          "https://tiles.openfreemap.org/planet/20260913_164504_pt/14/8590/5729.pbf"
        )
      )
    ).toBe(true)
    expect(
      isMapTileRequest(
        request("https://tiles.openfreemap.org/fonts/Noto%20Sans/0-255.pbf")
      )
    ).toBe(false)
  })

  test("does not cache Maptoolkit tile or TileJSON responses", () => {
    expect(
      isMapTileRequest(
        request("https://tiles.maptoolkit.org/mtk/14/8590/5729.mvt")
      )
    ).toBe(false)
    expect(
      isMapStyleRequest(request("https://tiles.maptoolkit.org/mtk.json"))
    ).toBe(false)
  })

  test("keeps unrelated JSON style-route behavior", () => {
    expect(
      isMapStyleRequest(request("https://example.test/styles/dark.json"))
    ).toBe(true)
    expect(
      isMapStyleRequest(request("https://example.test/api/activities"))
    ).toBe(false)
  })
})
