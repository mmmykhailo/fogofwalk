import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/app"
import { waitForMapIdle } from "../fixtures/performance"
import {
  installTrailArchive,
  observeTrailArchive,
  TRAIL_ARCHIVE_URL,
  TRAIL_TEST_CENTER,
  TRAIL_TEST_ZOOM,
  type TrailArchiveMode,
} from "../fixtures/trails-pmtiles"

const TRAIL_SOURCE_ID = "trails-source"
const TRAIL_LAYER_IDS = [
  "trails-hiking-casing-layer",
  "trails-hiking-layer",
  "trails-cycling-layer",
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
        sources: [Boolean(map.getSource(sourceId))],
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
      .querySourceFeatures(sourceId, { sourceLayer: "trails" })
      .map((feature) => {
        const properties = (
          feature as { properties?: Record<string, unknown> | null }
        ).properties
        return properties ?? {}
      })
  }, TRAIL_SOURCE_ID)
}

async function renderedTrailFeatureCount(page: Page): Promise<number> {
  return page.evaluate(
    (layerIds) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      return map
        .queryRenderedFeatures(undefined, { layers: layerIds })
        .filter((feature) => {
          const geometry = (
            feature as { geometry?: { type?: unknown } | undefined }
          ).geometry
          const type = geometry?.type
          return type === "LineString" || type === "MultiLineString"
        }).length
    },
    [...TRAIL_LAYER_IDS]
  )
}

async function assertRenderedTrailFeatures(page: Page): Promise<void> {
  await expect
    .poll(() => renderedTrailFeatureCount(page), { timeout: 20_000 })
    .toBeGreaterThan(0)
}

async function trailReconciliationEvents(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const typedWindow = window as Window & {
      __fogofwalkE2eTrailEvents?: unknown[]
    }
    return typedWindow.__fogofwalkE2eTrailEvents ?? []
  })
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
      const properties = await sourceProperties(page)
      const expectedKeys = ["color", "kind", "offset", "sort"]
      return {
        hiking: properties.some(
          (item) =>
            item.kind === "hiking" &&
            item.color === "#d9272e" &&
            typeof item.offset === "number" &&
            typeof item.sort === "number"
        ),
        cycling: properties.some(
          (item) =>
            item.kind === "cycling" &&
            item.color === "#ec4899" &&
            item.offset === 0 &&
            typeof item.sort === "number"
        ),
        schema: properties.every(
          (item) =>
            JSON.stringify(Object.keys(item).sort()) ===
            JSON.stringify(expectedKeys)
        ),
      }
    })
    .toEqual({ hiking: true, cycling: true, schema: true })
}

async function assertTrailSource(page: Page): Promise<void> {
  const source = await page.evaluate((sourceId) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    const sources = map.getStyle().sources ?? {}
    const styleSource = sources[sourceId] as
      | { type?: unknown; url?: unknown; attribution?: unknown }
      | undefined
    return {
      sourceIds: Object.keys(sources).filter((id) => id.startsWith("trails-")),
      type: styleSource?.type,
      url: styleSource?.url,
      attribution: styleSource?.attribution,
    }
  }, TRAIL_SOURCE_ID)

  expect(source.sourceIds).toEqual([TRAIL_SOURCE_ID])
  expect(source.type).toBe("vector")
  expect(source.url).toBe(`pmtiles://${TRAIL_ARCHIVE_URL}`)
  expect(source.attribution).toContain("OpenStreetMap contributors")
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

function trackForbiddenTrailTraffic(page: Page): string[] {
  const urls: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    if (
      /(?:waymarkedtrails\.org|overpass-api\.de|api\.openstreetmap\.org|tile\.openstreetmap\.org)/i.test(
        url
      )
    ) {
      urls.push(url)
    }
  })
  return urls
}

test.describe("trail overlay", () => {
  test.afterEach(async ({ app }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return
    const events = await trailReconciliationEvents(app.page).catch(
      () => [] as unknown[]
    )
    console.log(`trail reconciliation events: ${JSON.stringify(events)}`)
  })

  test("renders trails on the first eligible load without toggling", async ({
    app,
  }) => {
    const fixture = await installTrailArchive(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()

    await app.openDrawer()
    await expect(
      app.drawer.getByRole("switch", { name: "Show trails" })
    ).toBeChecked()
    await app.closeDrawer()

    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailSource(app.page)
    await assertTrailFeatures(app.page)
    await assertRenderedTrailFeatures(app.page)

    const events = await trailReconciliationEvents(app.page)
    expect(
      events.some((event) => {
        if (!event || typeof event !== "object") return false
        const candidate = event as {
          trigger?: unknown
          sourceAfter?: unknown
          layersAfter?: unknown
        }
        return (
          candidate.trigger === "initial-load" &&
          candidate.sourceAfter === true &&
          Array.isArray(candidate.layersAfter) &&
          candidate.layersAfter.every((layer) => layer === true)
        )
      })
    ).toBe(true)
  })

  test("crosses the trail threshold without toggling", async ({ app }) => {
    const fixture = await installTrailArchive(app.page)
    await installSavedMapPosition(app.page, 11.99)
    await app.goto()

    expect(fixture.requests).toHaveLength(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false] })

    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailFeatures(app.page)
    await assertRenderedTrailFeatures(app.page)
  })

  test("renders trails on a warm reload without toggling", async ({ app }) => {
    const archive =
      process.env.E2E_TRAILS_PRODUCTION === "1"
        ? observeTrailArchive(app.page)
        : await installTrailArchive(app.page)
    await installSavedMapPosition(app.page, TRAIL_TEST_ZOOM)
    await app.goto()

    await expect
      .poll(() => archive.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertRenderedTrailFeatures(app.page)

    await app.reload()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailFeatures(app.page)
    await assertRenderedTrailFeatures(app.page)
  })

  test("uses one local PMTiles source, ranges, and toggle suppression", async ({
    app,
  }) => {
    const forbiddenRequests = trackForbiddenTrailTraffic(app.page)
    const fixture = await installTrailArchive(app.page)
    await app.goto()
    await rememberMap(app.page)

    await app.openDrawer()
    await expect(
      app.drawer.getByRole("switch", { name: "Show trails" })
    ).toBeChecked()
    await app.closeDrawer()

    await setCamera(app.page, TRAIL_TEST_CENTER, 11)
    expect(fixture.requests).toHaveLength(0)
    expect(await resourceState(app.page)).toEqual({
      layers: [false, false, false],
      sources: [false],
    })

    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailSource(app.page)
    await assertTrailFeatures(app.page)

    expect(
      fixture.requests.every(
        ({ authorization, cookie, range, status, url }) =>
          url === TRAIL_ARCHIVE_URL &&
          status === 206 &&
          range !== null &&
          /^bytes=\d+-\d*$/.test(range) &&
          authorization === null &&
          cookie === null
      )
    ).toBe(true)
    expect(forbiddenRequests).toEqual([])

    await setCamera(app.page, TRAIL_TEST_CENTER, 11)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false] })

    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false] })
    const requestCountAfterDisable = fixture.requests.length
    await setCamera(app.page, [14.42, 50.08], TRAIL_TEST_ZOOM)
    expect(fixture.requests.length).toBe(requestCountAfterDisable)
    expect(await hasSameMapObject(app.page)).toBe(true)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailFeatures(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)
  })

  test("keeps trail state and order through flat and relief styles", async ({
    app,
  }) => {
    const fixture = await installTrailArchive(app.page)
    await app.goto()
    await rememberMap(app.page)
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertFlatTrailOrder(app.page)

    await app.openDrawer()
    await app.drawer.getByTitle("Terrain").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertReliefTrailOrder(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false] })

    await app.openDrawer()
    await app.drawer.getByTitle("Standard").click()
    await app.closeDrawer()
    await waitForMapIdle(app.page)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [false, false, false], sources: [false] })

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Show trails" }).click()
    await app.closeDrawer()
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertFlatTrailOrder(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)
  })

  test("rehydrates trail resources after WebGL context restoration", async ({
    app,
  }) => {
    const fixture = await installTrailArchive(app.page)
    await app.goto()
    await rememberMap(app.page)
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => fixture.requests.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
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
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailFeatures(app.page)
    expect(await hasSameMapObject(app.page)).toBe(true)
  })

  test("uses a fixed pink dashed cycling style", async ({ app }) => {
    await installTrailArchive(app.page)
    await app.goto()
    await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
    await expect
      .poll(() => resourceState(app.page))
      .toEqual({ layers: [true, true, true], sources: [true] })
    await assertTrailFeatures(app.page)

    const cyclingStyle = await app.page.evaluate(() => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      const layer = map.getLayer("trails-cycling-layer") as
        | { source?: unknown; "source-layer"?: unknown }
        | undefined
      if (!layer) throw new Error("Cycling trail layer is unavailable")
      const styleLayer = map
        .getStyle()
        .layers?.find(
          (item) => (item as { id?: unknown }).id === "trails-cycling-layer"
        ) as { "source-layer"?: unknown } | undefined
      return {
        color: map.getPaintProperty("trails-cycling-layer", "line-color"),
        dash: map.getPaintProperty("trails-cycling-layer", "line-dasharray"),
        source: layer.source,
        sourceLayer: styleLayer?.["source-layer"],
      }
    })
    expect(cyclingStyle.color).toBe("#ec4899")
    expect(JSON.stringify(cyclingStyle.dash)).toContain("[2,2]")
    expect(cyclingStyle.source).toBe(TRAIL_SOURCE_ID)
    expect(cyclingStyle.sourceLayer).toBe("trails")
  })

  for (const mode of [
    "http",
    "not-found",
    "range",
    "truncated",
    "cors",
    "invalid-pmtiles",
    "offline",
  ] as const satisfies readonly TrailArchiveMode[]) {
    test(`keeps the map, imports, and saved points usable after ${mode} archive failure`, async ({
      app,
    }) => {
      const forbiddenRequests = trackForbiddenTrailTraffic(app.page)
      const fixture = await installTrailArchive(app.page)
      fixture.state.mode = mode
      await app.goto()
      await setCamera(app.page, TRAIL_TEST_CENTER, TRAIL_TEST_ZOOM)
      await expect(app.openDrawerButton).toBeVisible()
      expect(fixture.requests.length).toBeGreaterThan(0)
      expect(
        fixture.requests.every(({ url }) => url === TRAIL_ARCHIVE_URL)
      ).toBe(true)
      expect(forbiddenRequests).toEqual([])

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
  }
})
