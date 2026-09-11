import type { Page, TestInfo } from "@playwright/test"
import { test, expect } from "../fixtures/app"
import { makeFogVisualGpx } from "../fixtures/gpx"
import type { AppPage } from "../fixtures/app-page"

const VISUAL_STYLE = {
  version: 8,
  name: "fog-visual",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e8eef7" } },
  ],
}

type Pixel = [number, number, number, number]

interface FogVisualMap {
  project(coordinate: [number, number]): { x: number; y: number }
  getCanvas(): HTMLCanvasElement
  jumpTo(options: { center: [number, number]; zoom: number }): void
}

declare global {
  interface Window {
    __fogofwalkE2eMap?: FogVisualMap
  }
}

async function readPixel(
  page: Page,
  coordinate: [number, number]
): Promise<Pixel> {
  return page.evaluate((lngLat: [number, number]) => {
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

async function readInteriorLuminances(page: Page): Promise<number[]> {
  const samples: [number, number][] = []
  for (let x = 13.47; x <= 13.53; x += 0.01) {
    for (let y = 52.47; y <= 52.53; y += 0.01) {
      samples.push([x, y])
    }
  }
  const pixels = await Promise.all(
    samples.map((sample) => readPixel(page, sample))
  )
  return pixels.map(([red, green, blue]) => (red + green + blue) / 3)
}

async function runFogVisualCheck(app: AppPage, testInfo: TestInfo) {
  await app.page.route(
    "https://tiles.openfreemap.org/styles/liberty",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(VISUAL_STYLE),
      })
  )
  await app.goto()
  await app.importFiles([makeFogVisualGpx()])
  await app.waitForImportToSettle()

  await app.openDrawer()
  await app.drawer.getByRole("switch", { name: "Fill loops" }).click()
  await app.closeDrawer()
  await app.waitForImportToSettle()
  await app.openDrawer()
  await app.drawer.getByRole("switch", { name: "Show activities" }).click()
  await app.closeDrawer()

  await app.page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    map.jumpTo({ center: [13.5, 52.5], zoom: 11 })
  })

  const canvas = app.page.locator(".maplibregl-canvas").first()
  await expect(canvas).toBeVisible()
  for (const zoom of [11, 11.5]) {
    await app.page.evaluate((nextZoom) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      map.jumpTo({ center: [13.5, 52.5], zoom: nextZoom })
    }, zoom)
    await app.page.waitForTimeout(150)
    await canvas.screenshot({ path: testInfo.outputPath(`fog-z${zoom}.png`) })

    const explored = await readPixel(app.page, [13.5, 52.5])
    const covered = await readPixel(app.page, [13.65, 52.5])
    expect(explored[0]).toBeGreaterThan(covered[0] + 80)
    expect(explored[1]).toBeGreaterThan(covered[1] + 80)
    expect(explored[2]).toBeGreaterThan(covered[2] + 80)

    const luminances = await readInteriorLuminances(app.page)
    expect(Math.max(...luminances) - Math.min(...luminances)).toBeLessThan(18)
  }
}

test.describe("positive fog mask rendering at DPR 1", () => {
  test.use({ deviceScaleFactor: 1 })

  test("has stable explored samples without internal triangle seams", async ({
    app,
  }, testInfo) => {
    await runFogVisualCheck(app, testInfo)
  })
})

test.describe("positive fog mask rendering at DPR 2", () => {
  test.use({ deviceScaleFactor: 2 })

  test("has stable explored samples without internal triangle seams", async ({
    app,
  }, testInfo) => {
    await runFogVisualCheck(app, testInfo)
  })
})
