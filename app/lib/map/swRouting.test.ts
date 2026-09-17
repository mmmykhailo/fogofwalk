import { describe, expect, test } from "bun:test"
import { isMapStyleRequest, isMapTileRequest } from "./swRouting"

function request(url: string): { url: URL } {
  return { url: new URL(url) }
}

describe("service worker map resource routing", () => {
  test("keeps existing basemap tile caching", () => {
    expect(
      isMapTileRequest(
        request("https://tiles.openfreemap.org/14/8590/5729.mvt")
      )
    ).toBe(true)
    expect(
      isMapTileRequest(
        request("https://server.example.test/tiles/14/8590/5729")
      )
    ).toBe(true)
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
