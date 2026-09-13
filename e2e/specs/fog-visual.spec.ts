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

async function prepareFogVisual(app: AppPage, fillLoops: boolean) {
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

  if (fillLoops) {
    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Fill loops" }).click()
    await app.closeDrawer()
    await app.waitForImportToSettle()
  }
  await app.openDrawer()
  await app.drawer.getByRole("switch", { name: "Show activities" }).click()
  await app.closeDrawer()
}

async function runFogVisualCheck(app: AppPage, testInfo: TestInfo) {
  await prepareFogVisual(app, true)

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

type FogZoomSample = {
  zoom: number
  projectedX: number
  left: number
  right: number
  midpoint: number
  delta: number
}

type FogZoomReadings = {
  samples: FogZoomSample[]
  renderFrames: number
  thresholdFrames: number
  leftEdgeFrames: number
  rightEdgeFrames: number
}

async function readFogZoomSamples(
  page: Page,
  threshold: number
): Promise<FogZoomReadings> {
  return page.evaluate(
    (sampledThreshold) =>
      new Promise<FogZoomReadings>((resolve, reject) => {
        const map = window.__fogofwalkE2eMap
        if (!map) throw new Error("MapLibre test handle is unavailable")
        const canvas = map.getCanvas()
        const gl =
          (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
          (canvas.getContext("webgl") as WebGLRenderingContext | null)
        if (!gl) throw new Error("MapLibre WebGL context is unavailable")

        const routePoint: [number, number] = [13.45, 52.5]
        const samples: FogZoomSample[] = []
        let renderFrames = 0
        let thresholdFrames = 0
        let leftEdgeFrames = 0
        let rightEdgeFrames = 0
        let timeoutId: number | undefined

        const finish = () => {
          if (timeoutId !== undefined) window.clearTimeout(timeoutId)
          map.off("render", readFrame)
          resolve({
            samples,
            renderFrames,
            thresholdFrames,
            leftEdgeFrames,
            rightEdgeFrames,
          })
        }

        const readFrame = () => {
          renderFrames += 1
          const projected = map.project(routePoint)
          const scaleX = canvas.width / canvas.clientWidth
          const scaleY = canvas.height / canvas.clientHeight
          const pointX = projected.x * scaleX
          const pointY = projected.y * scaleY
          const row = canvas.height - 1 - Math.round(pointY)
          const startY = Math.max(0, Math.min(canvas.height - 3, row - 1))
          // The route point is centered before the animation. Scan the full
          // horizontal viewport because the corridor edges expand rapidly as
          // the zoom approaches 18.
          const scanStart = Math.max(0, Math.floor(pointX - canvas.width * 0.5))
          const scanEnd = Math.min(
            canvas.width,
            Math.ceil(pointX + canvas.width * 0.5)
          )
          const scanWidth = scanEnd - scanStart
          const pixels = new Uint8Array(scanWidth * 3 * 4)
          gl.readPixels(
            scanStart,
            startY,
            scanWidth,
            3,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
          )

          const luminances = new Float32Array(scanWidth)
          for (let x = 0; x < scanWidth; x += 1) {
            let total = 0
            for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
              const offset = (rowIndex * scanWidth + x) * 4
              total +=
                (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) /
                3
            }
            luminances[x] = total / 3
          }

          const pointIndex = Math.max(
            0,
            Math.min(scanWidth - 1, Math.round(pointX - scanStart))
          )
          const exploredLuminance = luminances[pointIndex]!
          if (exploredLuminance <= sampledThreshold + 1) {
            return
          }
          thresholdFrames += 1

          let left: number | null = null
          for (let x = pointIndex; x > 0; x -= 1) {
            const before = luminances[x - 1]!
            const after = luminances[x]!
            if (before <= sampledThreshold && after > sampledThreshold) {
              left =
                x -
                1 +
                (sampledThreshold - before) / Math.max(1e-6, after - before)
              break
            }
          }
          if (left !== null) leftEdgeFrames += 1

          let right: number | null = null
          for (let x = pointIndex; x < scanWidth - 1; x += 1) {
            const before = luminances[x]!
            const after = luminances[x + 1]!
            if (before > sampledThreshold && after <= sampledThreshold) {
              right =
                x +
                (sampledThreshold - before) / Math.min(-1e-6, after - before)
              break
            }
          }
          if (right !== null) rightEdgeFrames += 1
          if (left === null || right === null || right <= left) return

          const midpoint = (left + right) / 2 / scaleX + scanStart / scaleX
          samples.push({
            zoom: map.getZoom(),
            projectedX: projected.x,
            left: (left + scanStart) / scaleX,
            right: (right + scanStart) / scaleX,
            midpoint,
            delta: midpoint - projected.x,
          })
        }

        map.on("render", readFrame)
        map.once("zoomend", finish)
        timeoutId = window.setTimeout(() => {
          map.off("render", readFrame)
          reject(
            new Error(`Timed out with ${samples.length} usable fog frames`)
          )
        }, 10_000)
        map.easeTo({ zoom: 18, duration: 1_600, essential: true })
      }),
    threshold
  )
}

async function runFogZoomJitterCheck(app: AppPage) {
  await prepareFogVisual(app, false)
  await app.page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    map.jumpTo({ center: [13.45, 52.5], zoom: 15.5 })
  })
  await app.page.waitForTimeout(150)
  await expect
    .poll(
      async () => {
        const [explored, covered] = await Promise.all([
          readPixel(app.page, [13.45, 52.5]),
          readPixel(app.page, [13.65, 52.5]),
        ])
        return explored[0] - covered[0]
      },
      { timeout: 5_000 }
    )
    .toBeGreaterThan(80)

  const [explored, covered] = await Promise.all([
    readPixel(app.page, [13.45, 52.5]),
    readPixel(app.page, [13.65, 52.5]),
  ])
  const exploredLuminance = (explored[0] + explored[1] + explored[2]) / 3
  const coveredLuminance = (covered[0] + covered[1] + covered[2]) / 3
  const readings = await readFogZoomSamples(
    app.page,
    (exploredLuminance + coveredLuminance) / 2
  )
  const { samples } = readings
  expect(
    samples.length,
    `Fog zoom detector diagnostics: ${JSON.stringify({
      renderFrames: readings.renderFrames,
      thresholdFrames: readings.thresholdFrames,
      leftEdgeFrames: readings.leftEdgeFrames,
      rightEdgeFrames: readings.rightEdgeFrames,
    })}`
  ).toBeGreaterThanOrEqual(20)
  const deltas = samples.map((sample) => sample.delta)
  const minimumDelta = Math.min(...deltas)
  const maximumDelta = Math.max(...deltas)
  const excursion = maximumDelta - minimumDelta
  if (excursion > 2) {
    const worstSamples = [...samples]
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 5)
      .map((sample) => ({
        zoom: Number(sample.zoom.toFixed(3)),
        projectedX: Number(sample.projectedX.toFixed(3)),
        left: Number(sample.left.toFixed(3)),
        right: Number(sample.right.toFixed(3)),
        delta: Number(sample.delta.toFixed(3)),
      }))
    throw new Error(
      `Fog edge excursion was ${excursion.toFixed(3)} CSS px; worst frames: ${JSON.stringify(worstSamples)}`
    )
  }
}

test.describe("positive fog mask rendering at DPR 1", () => {
  test.use({ deviceScaleFactor: 1 })

  test("[F-038] has stable explored samples without internal triangle seams", async ({
    app,
  }, testInfo) => {
    await runFogVisualCheck(app, testInfo)
  })
})

test.describe("positive fog mask rendering at DPR 2", () => {
  test.use({ deviceScaleFactor: 2 })

  test("[F-038] has stable explored samples without internal triangle seams", async ({
    app,
  }, testInfo) => {
    await runFogVisualCheck(app, testInfo)
  })
})

test.describe("positive fog mask zoom stability at DPR 1", () => {
  test.use({ deviceScaleFactor: 1 })

  test("[F-039] keeps the corridor edge locked during animated zoom", async ({
    app,
  }) => {
    await runFogZoomJitterCheck(app)
  })
})

test.describe("positive fog mask zoom stability at DPR 2", () => {
  test.use({ deviceScaleFactor: 2 })

  test("[F-039] keeps the corridor edge locked during animated zoom", async ({
    app,
  }) => {
    await runFogZoomJitterCheck(app)
  })
})
