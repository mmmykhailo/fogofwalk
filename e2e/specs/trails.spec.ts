import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/app"
import { waitForMapIdle } from "../fixtures/performance"
import {
  makeTrailTile,
  parseTrailTestPath,
  tileForLngLat,
  trailLineLngLat,
  TRAIL_TEST_CENTER,
  TRAIL_TEST_ZOOM,
  type TrailTestTheme,
} from "../fixtures/trails"

const TRAIL_SOURCE_IDS = [
  "trails-hiking-source",
  "trails-cycling-source",
] as const
const TRAIL_LAYER_IDS = [
  "trails-hiking-casing-layer",
  "trails-hiking-layer",
  "trails-cycling-layer",
] as const
const TRAIL_PROVIDER_URL_PATTERN = new RegExp(
  `^https://(?:hiking|cycling)\\.waymarkedtrails\\.org/api/v1/tiles/${TRAIL_TEST_ZOOM}/\\d+/\\d+\\.json$`
)

type TrailFixtureMode = "success" | "http" | "invalid-json" | "offline"

interface TrailRequest {
  theme: TrailTestTheme
  x: number
  y: number
  url: string
}

async function installTrailFixtures(page: Page) {
  const requests: TrailRequest[] = []
  const state: { mode: TrailFixtureMode } = { mode: "success" }

  for (const theme of ["hiking", "cycling"] as const) {
    await page.route(
      "https://" + theme + ".waymarkedtrails.org/api/v1/tiles/**",
      async (route) => {
        const url = new URL(route.request().url())
        const tile = parseTrailTestPath(url.pathname)
        if (
          !tile ||
          tile.x < 0 ||
          tile.x >= 2 ** TRAIL_TEST_ZOOM ||
          tile.y < 0 ||
          tile.y >= 2 ** TRAIL_TEST_ZOOM
        ) {
          await route.abort()
          return
        }

        requests.push({ theme, ...tile, url: url.toString() })
        if (state.mode === "http") {
          await route.fulfill({
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: "synthetic provider failure",
          })
          return
        }
        if (state.mode === "invalid-json") {
          await route.fulfill({
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json",
            },
            body: "{not valid json",
          })
          return
        }
        if (state.mode === "offline") {
          await route.abort("failed")
          return
        }

        const body = JSON.stringify(makeTrailTile(theme, tile.x, tile.y))
        await route.fulfill({
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
          },
          body,
        })
      }
    )
  }

  return { requests, state }
}

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

async function resourceState(page: Page) {
  return page.evaluate(
    ({ layerIds, sourceIds }) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return {
        layers: layerIds.map((id) => Boolean(map.getLayer(id))),
        sources: sourceIds.map((id) => Boolean(map.getSource(id))),
      }
    },
    { layerIds: TRAIL_LAYER_IDS, sourceIds: TRAIL_SOURCE_IDS }
  )
}

async function renderedTrailFeatureCount(page: Page): Promise<number> {
  return page.evaluate((layerIds) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return map.queryRenderedFeatures(undefined, { layers: layerIds }).length
  }, TRAIL_LAYER_IDS)
}

async function sourceProperties(page: Page, sourceId: string) {
  return page.evaluate((id) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return map
      .querySourceFeatures(id, { sourceLayer: "trails" })
      .map((feature) => {
        const properties = (
          feature as { properties?: Record<string, unknown> | null }
        ).properties
        return properties ?? {}
      })
  }, sourceId)
}

async function styleLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    return (map.getStyle().layers ?? [])
      .map((layer) => (layer as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string")
  })
}

async function rememberMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    window.__fogofwalkE2eOriginalMap = map
  })
}

async function hasSameMapObject(page: Page): Promise<boolean> {
  return page.evaluate(
    () => window.__fogofwalkE2eMap === window.__fogofwalkE2eOriginalMap
  )
}

async function assertTrailFeatures(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const [hiking, cycling] = await Promise.all([
        sourceProperties(page, TRAIL_SOURCE_IDS[0]),
        sourceProperties(page, TRAIL_SOURCE_IDS[1]),
      ])
      return {
        hiking: hiking.some(
          (properties) =>
            properties.kind === "hiking" && properties.color === "#d9272e"
        ),
        cycling: cycling.some(
          (properties) =>
            properties.kind === "cycling" && properties.color === "#ec4899"
        ),
      }
    })
    .toEqual({ hiking: true, cycling: true })
}

function layerIndex(ids: string[], id: string): number {
  const index = ids.indexOf(id)
  if (index < 0) throw new Error("Missing expected layer: " + id)
  return index
}

async function assertFlatTrailOrder(page: Page): Promise<void> {
  const ids = await styleLayerIds(page)
  expect(layerIndex(ids, TRAIL_LAYER_IDS[0])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[1])
  )
  expect(layerIndex(ids, TRAIL_LAYER_IDS[1])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[2])
  )
  if (ids.includes("fog-layer")) {
    expect(layerIndex(ids, TRAIL_LAYER_IDS[2])).toBeLessThan(
      layerIndex(ids, "fog-layer")
    )
    expect(layerIndex(ids, "fog-layer")).toBeLessThan(
      layerIndex(ids, "activities-layer")
    )
  } else {
    expect(layerIndex(ids, TRAIL_LAYER_IDS[2])).toBeLessThan(
      layerIndex(ids, "activities-layer")
    )
  }
}

async function assertReliefTrailOrder(page: Page): Promise<void> {
  const ids = await styleLayerIds(page)
  expect(layerIndex(ids, TRAIL_LAYER_IDS[0])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[1])
  )
  expect(layerIndex(ids, TRAIL_LAYER_IDS[1])).toBeLessThan(
    layerIndex(ids, TRAIL_LAYER_IDS[2])
  )
  expect(layerIndex(ids, TRAIL_LAYER_IDS[2])).toBeLessThan(
    layerIndex(ids, "activities-layer")
  )
  expect(ids).not.toContain("fog-layer")
}

type Pixel = [number, number, number, number]

async function readPixel(
  page: Page,
  coordinate: [number, number]
): Promise<Pixel> {
  return page.evaluate((lngLat) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    const point = map.project(lngLat)
    const canvas = map.getCanvas()
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null)
    if (!gl) throw new Error("MapLibre WebGL context is unavailable")
    const scaleX = canvas.width / canvas.clientWidth
    const scaleY = canvas.height / canvas.clientHeight
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.round(point.x * scaleX))
    )
    const y = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        canvas.height - 1 - Math.round(point.y * scaleY)
      )
    )
    const pixel = new Uint8Array(4)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!] as Pixel
  }, coordinate)
}

function isPink(pixel: Pixel): boolean {
  return (
    pixel[0] >= 110 &&
    pixel[1] <= 100 &&
    pixel[2] >= 75 &&
    pixel[1] < pixel[0] * 0.65 &&
    pixel[1] < pixel[2] * 0.75
  )
}

test.describe("trail overlay", () => {
  test("uses only fixed z12 fixtures and removes resources when toggled", async ({
    app,
  }) => {
    const fixture = await installTrailFixtures(app.page)
    await app.goto()
    await rememberMap(app.page)

    await app.openDrawer()
    await expect(
      app.drawer.getByRole("switch", { name: "Show trails" })
    ).toBeChecked()
    await app.closeDrawer()

    await setCamera(app.page, TRAIL_TEST_CENTER, 11)
    expect(fixture.requests).toHaveLength(0)
    expect(await renderedTrailFeatureCount(app.page)).toBe(0)

    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await waitForMapIdle(app.page)

    expect(
      fixture.requests.every(
        ({ theme, x, y, url }) =>
          (theme === "hiking" || theme === "cycling") &&
          TRAIL_PROVIDER_URL_PATTERN.test(url) &&
          x >= 0 &&
          x < 2 ** TRAIL_TEST_ZOOM &&
          y >= 0 &&
          y < 2 ** TRAIL_TEST_ZOOM
      )
    ).toBe(true)
    await assertTrailFeatures(app.page)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false, false] })
    const requestCountAfterDisable = fixture.requests.length
    await setCamera(app.page, [16.1, 50.08], TRAIL_TEST_ZOOM)
    expect(fixture.requests).toHaveLength(requestCountAfterDisable)
    expect(await hasSameMapObject(app.page)).toBe(true)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true, true] })
    await setCamera(app.page, [18.1, 50.08], TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(requestCountAfterDisable)
    expect(await hasSameMapObject(app.page)).toBe(true)
  })

  test("keeps trail state and order through flat and relief styles", async ({
    app,
  }) => {
    const fixture = await installTrailFixtures(app.page)
    await app.goto()
    await rememberMap(app.page)
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true, true] })
    await assertFlatTrailOrder(app.page)

    await app.openDrawer()
    await app.drawer.getByTitle("Terrain").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true, true] })
    await assertReliefTrailOrder(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false, false] })

    await app.openDrawer()
    await app.drawer.getByTitle("Standard").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false, false] })

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true, true] })
    await assertFlatTrailOrder(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)
  })

  test("renders a visibly dashed pink cycling route", async ({ app }) => {
    await installTrailFixtures(app.page)
    await app.goto()
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true, true] })
    await assertTrailFeatures(app.page)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show fog" }).click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)

    const tile = tileForLngLat(TRAIL_TEST_CENTER)
    const [start, end] = trailLineLngLat("cycling", tile.x, tile.y)
    const samples = Array.from({ length: 32 }, (_, index) => {
      const fraction = 0.06 + (index / 31) * 0.88
      return [
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ] as [number, number]
    })
    const pixels = await Promise.all(
      samples.map((coordinate) => readPixel(app.page, coordinate))
    )
    const pinkPixels = pixels.filter(isPink).length
    expect(pinkPixels).toBeGreaterThanOrEqual(3)
    expect(pixels.length - pinkPixels).toBeGreaterThanOrEqual(3)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false, false] })
    await waitForMapIdle(app.page)
    const pixelsAfterDisable = await Promise.all(
      samples.map((coordinate) => readPixel(app.page, coordinate))
    )
    expect(pixelsAfterDisable.filter(isPink)).toHaveLength(0)
  })

  test("keeps the map and local features usable after provider failures", async ({
    app,
  }) => {
    const fixture = await installTrailFixtures(app.page)
    await app.goto()

    fixture.state.mode = "http"
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    fixture.state.mode = "invalid-json"
    await setCamera(app.page, [15.4, 50.08], TRAIL_TEST_ZOOM)
    fixture.state.mode = "offline"
    await setCamera(app.page, [16.4, 50.08], TRAIL_TEST_ZOOM)
    await expect(app.openDrawerButton).toBeVisible()

    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.expectActivityCount(1)

    await app.seedSavedPoint({
      id: "00000000-0000-4000-8000-000000000321",
      name: "Trail failure fixture point",
      description: null,
      lng: 14.42,
      lat: 50.08,
      color: "purple",
      isPublic: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    await app.reload()
    await app.openDrawer()
    await expect(
      app.drawer.getByRole("switch", { name: "Show saved points" })
    ).toBeVisible()
    await expect(
      app.drawer.getByRole("switch", { name: "Show trails" })
    ).toBeVisible()
  })
})
