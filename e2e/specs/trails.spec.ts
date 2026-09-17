import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/app"
import { waitForMapIdle } from "../fixtures/performance"
import {
  installTrailTiles,
  MAPTOOLKIT_TILEJSON_URL,
  TRAIL_TEST_CENTER,
  TRAIL_TEST_ZOOM,
  type TrailTileMode,
} from "../fixtures/trails-maptoolkit"

const TRAIL_SOURCE_ID = "trails-source"
const TRAIL_LAYER_IDS = [
  "trails-cycling-layer",
  "trails-hiking-casing-layer",
  "trails-hiking-layer",
] as const

async function setCamera(
  page: Page,
  center: [number, number],
  zoom: number
): Promise<void> {
  await page.evaluate(
    ({ nextCenter, nextZoom }) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        map.once("idle", finish)
        map.jumpTo({ center: nextCenter, zoom: nextZoom })
        window.setTimeout(finish, 2_000)
      })
    },
    { nextCenter: center, nextZoom: zoom }
  )
  await waitForMapIdle(page)
}

async function installSavedMapPosition(
  page: Page,
  zoom: number
): Promise<void> {
  await page.addInitScript(
    ({ center, nextZoom }) => {
      localStorage.setItem(
        "fogofwalk:mapPosition",
        JSON.stringify({ center, zoom: nextZoom })
      )
    },
    { center: TRAIL_TEST_CENTER, nextZoom: zoom }
  )
}

async function resourceState(page: Page) {
  return page.evaluate(
    ({ layerIds, sourceId }) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return {
        layers: layerIds.map((id) => Boolean(map.getLayer(id))),
        source: Boolean(map.getSource(sourceId)),
        logoCount: document.querySelectorAll(".maptoolkit-logo-control").length,
      }
    },
    { layerIds: TRAIL_LAYER_IDS, sourceId: TRAIL_SOURCE_ID }
  )
}

async function sourceProperties(page: Page) {
  return page.evaluate((sourceId) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return map
      .querySourceFeatures(sourceId, { sourceLayer: "road" })
      .map((feature) => feature.properties ?? {})
  }, TRAIL_SOURCE_ID)
}

async function renderedTrailFeatureCount(page: Page): Promise<number> {
  return page.evaluate(
    (layerIds) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return map.queryRenderedFeatures(undefined, { layers: layerIds }).length
    },
    [...TRAIL_LAYER_IDS]
  )
}

async function styleLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return map.getLayersOrder()
  })
}

function layerIndex(ids: string[], id: string): number {
  const index = ids.indexOf(id)
  if (index < 0) throw new Error(`Missing expected layer: ${id}`)
  return index
}

async function assertTrailOrder(page: Page, expectFog: boolean): Promise<void> {
  const ids = await styleLayerIds(page)
  expect(layerIndex(ids, TRAIL_LAYER_IDS[0])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[1])
  )
  expect(layerIndex(ids, TRAIL_LAYER_IDS[1])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[2])
  )
  if (expectFog) {
    expect(layerIndex(ids, TRAIL_LAYER_IDS[2])).toBeLessThan(
      layerIndex(ids, "fog-layer")
    )
    expect(layerIndex(ids, "fog-layer")).toBeLessThan(
      layerIndex(ids, "activities-layer")
    )
  } else {
    expect(ids).not.toContain("fog-layer")
    expect(layerIndex(ids, TRAIL_LAYER_IDS[2])).toBeLessThan(
      layerIndex(ids, "activities-layer")
    )
  }
}

async function assertTrailFeatures(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const properties = await sourceProperties(page)
      return {
        hiking: properties.some((item) => item.walking_network === "nwn"),
        cycling: properties.some((item) => item.cycling_network === "lcn"),
      }
    })
    .toEqual({ hiking: true, cycling: true })
  await expect
    .poll(() => renderedTrailFeatureCount(page), { timeout: 20_000 })
    .toBeGreaterThan(0)
}

test.describe("Maptoolkit trail overlay", () => {
  test("renders real route-network fields on first load with required attribution", async ({
    app,
  }) => {
    const fixture = await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()

    await expect
      .poll(
        () =>
          fixture.requests.filter((request) => request.kind === "tile").length
      )
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({
        layers: [true, true, true],
        source: true,
        logoCount: 1,
      })
    await assertTrailFeatures(app.page)
    await assertTrailOrder(app.page, true)

    await app.openDrawer()
    await expect(
      app.drawer.getByRole("switch", { name: "Show trails" })
    ).toBeChecked()
    await app.closeDrawer()

    const source = await app.page.evaluate((sourceId) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return map.getStyle().sources?.[sourceId]
    }, TRAIL_SOURCE_ID)
    expect(source).toMatchObject({
      type: "vector",
      url: MAPTOOLKIT_TILEJSON_URL,
      maxzoom: 15,
    })

    const logo = app.page.locator(".maptoolkit-logo-control img")
    await expect(logo).toBeVisible()
    expect(
      await logo.evaluate((image) => image.getBoundingClientRect().height)
    ).toBe(24)
    await expect(app.page.locator(".maplibregl-ctrl-attrib")).toContainText(
      "Maptoolkit"
    )
    await expect(app.page.locator(".maplibregl-ctrl-attrib")).toContainText(
      "OpenStreetMap"
    )
    expect(
      fixture.requests.every(
        ({ authorization, cookie }) => authorization === null && cookie === null
      )
    ).toBe(true)
  })

  test("installs once and lets layer minzoom suppress tile requests", async ({
    app,
  }) => {
    const fixture = await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, 5)
    await app.goto()

    await expect
      .poll(() => resourceState(app.page))
      .toEqual({
        layers: [true, true, true],
        source: true,
        logoCount: 1,
      })
    expect(
      fixture.requests.filter((request) => request.kind === "tile")
    ).toHaveLength(0)

    await setCamera(app.page, TRAIL_TEST_CENTER, 7)
    await expect
      .poll(
        () =>
          fixture.requests.filter((request) => request.kind === "tile").length
      )
      .toBeGreaterThan(0)
  })

  test("removes and restores the source, layers, and attribution without remounting the map", async ({
    app,
  }) => {
    const fixture = await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()
    await assertTrailFeatures(app.page)
    await app.page.evaluate(() => {
      window.__fogofwalkE2eOriginalMap = window.__fogofwalkE2eMap
    })

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({
        layers: [false, false, false],
        source: false,
        logoCount: 0,
      })
    const requestCount = fixture.requests.length
    await setCamera(app.page, [14.5, 50.08], TRAIL_TEST_ZOOM)
    expect(fixture.requests).toHaveLength(requestCount)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({
        layers: [true, true, true],
        source: true,
        logoCount: 1,
      })
    expect(
      await app.page.evaluate(
        () => window.__fogofwalkE2eMap === window.__fogofwalkE2eOriginalMap
      )
    ).toBe(true)
  })

  test("rehydrates the overlay through relief and standard style changes", async ({
    app,
  }) => {
    await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()
    await assertTrailFeatures(app.page)
    await assertTrailOrder(app.page, true)

    await app.openDrawer()
    await app.drawer.getByTitle("Terrain").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({
        layers: [true, true, true],
        source: true,
        logoCount: 1,
      })
    await assertTrailFeatures(app.page)
    await assertTrailOrder(app.page, false)

    await app.openDrawer()
    await app.drawer.getByTitle("Standard").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await assertTrailFeatures(app.page)
    await assertTrailOrder(app.page, true)
  })

  test("rehydrates the overlay after WebGL context restoration", async ({
    app,
  }) => {
    await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()
    await assertTrailFeatures(app.page)

    const restored = await app.page.evaluate(() => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      const canvas = map.getCanvas()
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
      const extension = context?.getExtension("WEBGL_lose_context")
      if (!extension) return false

      return new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (value: boolean) => {
          if (settled) return
          settled = true
          map.off("webglcontextrestored", onMapRestored)
          canvas.removeEventListener("webglcontextrestored", onCanvasRestored)
          resolve(value)
        }
        const onMapRestored = () => finish(true)
        const onCanvasRestored = () => finish(true)
        map.once("webglcontextrestored", onMapRestored)
        canvas.addEventListener("webglcontextrestored", onCanvasRestored, {
          once: true,
        })
        extension.loseContext()
        window.setTimeout(() => extension.restoreContext(), 100)
        window.setTimeout(() => finish(false), 5_000)
      })
    })
    expect(restored).toBe(true)

    await expect
      .poll(() => resourceState(app.page), { timeout: 20_000 })
      .toEqual({ layers: [true, true, true], source: true, logoCount: 1 })
    await assertTrailFeatures(app.page)
    await assertTrailOrder(app.page, true)
  })

  test("uses Maptoolkit route-network fields and both trail visual styles", async ({
    app,
  }) => {
    await installTrailTiles(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()
    await assertTrailFeatures(app.page)

    const styles = await app.page.evaluate(() => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return ["trails-hiking-layer", "trails-cycling-layer"].map((id) => {
        const layer = map
          .getStyle()
          .layers?.find((candidate) => candidate.id === id)
        return {
          id,
          sourceLayer:
            layer && "source-layer" in layer ? layer["source-layer"] : null,
          filter: layer?.filter,
          color: map.getPaintProperty(id, "line-color"),
          dash: map.getPaintProperty(id, "line-dasharray"),
        }
      })
    })
    expect(styles[0]).toMatchObject({
      sourceLayer: "road",
      filter: [
        "in",
        ["get", "walking_network"],
        ["literal", ["iwn", "nwn", "rwn", "lwn"]],
      ],
      color: "#3b82f6",
    })
    expect(styles[1]).toMatchObject({
      sourceLayer: "road",
      filter: [
        "in",
        ["get", "cycling_network"],
        ["literal", ["icn", "ncn", "rcn", "lcn"]],
      ],
      color: "#4cb056",
    })
    expect(JSON.stringify(styles[0]?.dash)).toContain("[3,2]")
    expect(JSON.stringify(styles[1]?.dash)).toContain("[2,2]")
  })

  for (const mode of [
    "http",
    "invalid",
    "offline",
  ] as const satisfies readonly TrailTileMode[]) {
    test(`keeps local features usable after ${mode} trail tile failure`, async ({
      app,
    }) => {
      const fixture = await installTrailTiles(app.page)
      fixture.state.mode = mode
      await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
      await app.goto()

      await expect(app.openDrawerButton).toBeVisible()
      expect(fixture.requests.length).toBeGreaterThan(0)
      await app.importActivities(1)
      await app.waitForImportToSettle()
      await app.expectActivityCount(1)

      await app.openDrawer()
      await expect(
        app.drawer.getByRole("switch", { name: "Show trails" })
      ).toBeVisible()
    })
  }
})
