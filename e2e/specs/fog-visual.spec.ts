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

type FogZoomDirection = "in" | "out"

type FogZoomLegConfig = {
  startZoom: number
  endZoom: number
  direction: FogZoomDirection
}

type FogZoomSample = {
  leg: number
  direction: FogZoomDirection
  zoom: number
  projectedX: number
  left: number
  right: number
  midpoint: number
  delta: number
}

type FogZoomFrame = {
  leg: number
  direction: FogZoomDirection
  zoom: number
  projectedX: number
  left: number | null
  right: number | null
  midpoint: number | null
  delta: number | null
  centerDetected: boolean
  leftEdgeDetected: boolean
  rightEdgeDetected: boolean
  usable: boolean
}

type FogZoomLegReading = FogZoomLegConfig & {
  index: number
  renderFrames: number
  usableSamples: number
  completed: boolean
}

type FogZoomReadings = {
  frames: FogZoomFrame[]
  samples: FogZoomSample[]
  legs: FogZoomLegReading[]
  renderFrames: number
  thresholdFrames: number
  leftEdgeFrames: number
  rightEdgeFrames: number
  rejectedCenterFrames: number
  rejectedLeftEdgeFrames: number
  rejectedRightEdgeFrames: number
  completedLegs: number
  timedOut: boolean
}

type FogZoomDiagnosticSample = FogZoomSample

type FogZoomDirectionMetrics = {
  sampleCount: number
  minimumDelta: number | null
  maximumDelta: number | null
  excursion: number | null
  worstDeltas: FogZoomDiagnosticSample[]
}

type FogZoomDiagnostics = {
  renderFrames: number
  thresholdFrames: number
  leftEdgeFrames: number
  rightEdgeFrames: number
  rejectedFrames: {
    center: number
    leftEdge: number
    rightEdge: number
  }
  completedLegs: number
  timedOut: boolean
  legs: FogZoomLegReading[]
  zoom: {
    minimum: number | null
    maximum: number | null
    bands: number[]
    hasEndpointCoverage: boolean
    hasAllBands: boolean
    sufficient: boolean
  }
  excursions: {
    combined: FogZoomDirectionMetrics
    in: FogZoomDirectionMetrics
    out: FogZoomDirectionMetrics
  }
}

type FogZoomArtifact = {
  version: 1
  threshold: number | null
  frames: FogZoomFrame[]
  samples: FogZoomDiagnosticSample[]
  diagnostics: FogZoomDiagnostics | null
  error?: string
}

const FOG_ZOOM_MIN = 15.5
const FOG_ZOOM_MAX = 18
const FOG_ZOOM_BAND_COUNT = 5
const FOG_ZOOM_BAND_SIZE = (FOG_ZOOM_MAX - FOG_ZOOM_MIN) / FOG_ZOOM_BAND_COUNT
const FOG_ZOOM_ENDPOINT_WINDOW = 0.2
const FOG_ZOOM_REQUIRED_SAMPLES = 20
const FOG_ZOOM_MAX_EXCURSION = 2
const FOG_ZOOM_LEGS: FogZoomLegConfig[] = [
  { startZoom: FOG_ZOOM_MIN, endZoom: FOG_ZOOM_MAX, direction: "in" },
  { startZoom: FOG_ZOOM_MAX, endZoom: FOG_ZOOM_MIN, direction: "out" },
  { startZoom: FOG_ZOOM_MIN, endZoom: FOG_ZOOM_MAX, direction: "in" },
]

function roundFogZoomValue(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(3))
}

function compactFogZoomSample(sample: FogZoomSample): FogZoomDiagnosticSample {
  return {
    leg: sample.leg,
    direction: sample.direction,
    zoom: roundFogZoomValue(sample.zoom)!,
    projectedX: roundFogZoomValue(sample.projectedX)!,
    left: roundFogZoomValue(sample.left)!,
    right: roundFogZoomValue(sample.right)!,
    midpoint: roundFogZoomValue(sample.midpoint)!,
    delta: roundFogZoomValue(sample.delta)!,
  }
}

function compactFogZoomFrame(frame: FogZoomFrame): FogZoomFrame {
  return {
    ...frame,
    zoom: roundFogZoomValue(frame.zoom)!,
    projectedX: roundFogZoomValue(frame.projectedX)!,
    left: roundFogZoomValue(frame.left),
    right: roundFogZoomValue(frame.right),
    midpoint: roundFogZoomValue(frame.midpoint),
    delta: roundFogZoomValue(frame.delta),
  }
}

function summarizeFogZoomSamples(
  samples: FogZoomSample[]
): FogZoomDirectionMetrics {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      minimumDelta: null,
      maximumDelta: null,
      excursion: null,
      worstDeltas: [],
    }
  }

  const deltas = samples.map((sample) => sample.delta)
  const minimumDelta = Math.min(...deltas)
  const maximumDelta = Math.max(...deltas)
  return {
    sampleCount: samples.length,
    minimumDelta,
    maximumDelta,
    excursion: maximumDelta - minimumDelta,
    worstDeltas: [...samples]
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 5)
      .map(compactFogZoomSample),
  }
}

function readFogZoomDiagnostics(readings: FogZoomReadings): FogZoomDiagnostics {
  const samples = readings.samples
  const minimumZoom =
    samples.length === 0
      ? null
      : Math.min(...samples.map((sample) => sample.zoom))
  const maximumZoom =
    samples.length === 0
      ? null
      : Math.max(...samples.map((sample) => sample.zoom))
  const bands = Array.from({ length: FOG_ZOOM_BAND_COUNT }, (_, index) => {
    const lower = FOG_ZOOM_MIN + index * FOG_ZOOM_BAND_SIZE
    const upper = lower + FOG_ZOOM_BAND_SIZE
    return samples.filter((sample) => {
      const isLastBand = index === FOG_ZOOM_BAND_COUNT - 1
      return (
        sample.zoom >= lower &&
        (sample.zoom < upper || (isLastBand && sample.zoom <= FOG_ZOOM_MAX))
      )
    }).length
  })
  const hasEndpointCoverage =
    minimumZoom !== null &&
    maximumZoom !== null &&
    minimumZoom <= FOG_ZOOM_MIN + FOG_ZOOM_ENDPOINT_WINDOW &&
    maximumZoom >= FOG_ZOOM_MAX - FOG_ZOOM_ENDPOINT_WINDOW
  const hasAllBands = bands.every((count) => count > 0)
  const byDirection = {
    in: samples.filter((sample) => sample.direction === "in"),
    out: samples.filter((sample) => sample.direction === "out"),
  }

  return {
    renderFrames: readings.renderFrames,
    thresholdFrames: readings.thresholdFrames,
    leftEdgeFrames: readings.leftEdgeFrames,
    rightEdgeFrames: readings.rightEdgeFrames,
    rejectedFrames: {
      center: readings.rejectedCenterFrames,
      leftEdge: readings.rejectedLeftEdgeFrames,
      rightEdge: readings.rejectedRightEdgeFrames,
    },
    completedLegs: readings.completedLegs,
    timedOut: readings.timedOut,
    legs: readings.legs,
    zoom: {
      minimum: minimumZoom,
      maximum: maximumZoom,
      bands,
      hasEndpointCoverage,
      hasAllBands,
      sufficient:
        samples.length >= FOG_ZOOM_REQUIRED_SAMPLES &&
        hasEndpointCoverage &&
        hasAllBands,
    },
    excursions: {
      combined: summarizeFogZoomSamples(samples),
      in: summarizeFogZoomSamples(byDirection.in),
      out: summarizeFogZoomSamples(byDirection.out),
    },
  }
}

function describeFogZoomError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readFogZoomSamples(
  page: Page,
  threshold: number
): Promise<FogZoomReadings> {
  return page.evaluate(
    ({ sampledThreshold, legs }) =>
      new Promise<FogZoomReadings>((resolve) => {
        const map = window.__fogofwalkE2eMap
        if (!map) throw new Error("MapLibre test handle is unavailable")
        const mapRef = map
        const canvas = map.getCanvas()
        const gl =
          (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
          (canvas.getContext("webgl") as WebGLRenderingContext | null)
        if (!gl) throw new Error("MapLibre WebGL context is unavailable")

        const routePoint: [number, number] = [13.45, 52.5]
        const frames: FogZoomFrame[] = []
        const samples: FogZoomSample[] = []
        const legReadings: FogZoomLegReading[] = legs.map((leg, index) => ({
          ...leg,
          index,
          renderFrames: 0,
          usableSamples: 0,
          completed: false,
        }))
        let activeLegIndex: number | null = null
        let activeRenderHandler: (() => void) | null = null
        let activeZoomEndHandler: (() => void) | null = null
        let renderFrames = 0
        let thresholdFrames = 0
        let leftEdgeFrames = 0
        let rightEdgeFrames = 0
        let completedLegs = 0
        let timeoutId: number | undefined
        let finished = false

        const hasRequiredCoverage = (): boolean => {
          if (samples.length < 20) return false
          let minimumZoom = Infinity
          let maximumZoom = -Infinity
          const bandCounts = new Array(5).fill(0) as number[]
          for (const sample of samples) {
            minimumZoom = Math.min(minimumZoom, sample.zoom)
            maximumZoom = Math.max(maximumZoom, sample.zoom)
            const bandIndex = Math.min(
              4,
              Math.max(0, Math.floor((sample.zoom - 15.5) / 0.5))
            )
            bandCounts[bandIndex] = (bandCounts[bandIndex] ?? 0) + 1
          }
          return (
            minimumZoom <= 15.7 &&
            maximumZoom >= 17.8 &&
            bandCounts.every((count) => count > 0)
          )
        }

        const cleanupActiveLeg = () => {
          if (activeRenderHandler) {
            map.off("render", activeRenderHandler)
            activeRenderHandler = null
          }
          if (activeZoomEndHandler) {
            map.off("zoomend", activeZoomEndHandler)
            activeZoomEndHandler = null
          }
        }

        const finish = (timedOut: boolean) => {
          if (finished) return
          finished = true
          cleanupActiveLeg()
          if (timeoutId !== undefined) window.clearTimeout(timeoutId)
          resolve({
            frames,
            samples,
            legs: legReadings,
            renderFrames,
            thresholdFrames,
            leftEdgeFrames,
            rightEdgeFrames,
            rejectedCenterFrames: renderFrames - thresholdFrames,
            rejectedLeftEdgeFrames: thresholdFrames - leftEdgeFrames,
            rejectedRightEdgeFrames: thresholdFrames - rightEdgeFrames,
            completedLegs,
            timedOut,
          })
        }

        const readFrame = () => {
          if (finished || activeLegIndex === null) return
          const leg = legReadings[activeLegIndex]
          if (!leg) return

          renderFrames += 1
          leg.renderFrames += 1
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
          const centerDetected = exploredLuminance > sampledThreshold + 1
          let left: number | null = null
          let right: number | null = null

          if (centerDetected) {
            thresholdFrames += 1
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
          }

          const leftEdgeDetected = left !== null
          const rightEdgeDetected = right !== null
          if (leftEdgeDetected) leftEdgeFrames += 1
          if (rightEdgeDetected) rightEdgeFrames += 1
          const fullLeft = left === null ? null : (left + scanStart) / scaleX
          const fullRight = right === null ? null : (right + scanStart) / scaleX
          const midpoint =
            fullLeft === null || fullRight === null
              ? null
              : (fullLeft + fullRight) / 2
          const delta = midpoint === null ? null : midpoint - projected.x
          const usable =
            centerDetected &&
            leftEdgeDetected &&
            rightEdgeDetected &&
            fullLeft !== null &&
            fullRight !== null &&
            fullRight > fullLeft
          const frame: FogZoomFrame = {
            leg: leg.index,
            direction: leg.direction,
            zoom: map.getZoom(),
            projectedX: projected.x,
            left: fullLeft,
            right: fullRight,
            midpoint,
            delta,
            centerDetected,
            leftEdgeDetected,
            rightEdgeDetected,
            usable,
          }
          frames.push(frame)

          if (usable && midpoint !== null && delta !== null) {
            samples.push({
              leg: leg.index,
              direction: leg.direction,
              zoom: frame.zoom,
              projectedX: frame.projectedX,
              left: fullLeft!,
              right: fullRight!,
              midpoint,
              delta,
            })
            leg.usableSamples += 1
          }
        }

        function finishLeg() {
          if (finished || activeLegIndex === null) return
          const leg = legReadings[activeLegIndex]
          if (leg) leg.completed = true
          cleanupActiveLeg()
          activeLegIndex = null
          completedLegs += 1
          if (hasRequiredCoverage() || completedLegs >= legs.length) {
            finish(false)
            return
          }
          startLeg(completedLegs)
        }

        function startLeg(index: number) {
          if (finished) return
          const leg = legs[index]
          if (!leg) {
            finish(false)
            return
          }
          activeLegIndex = index
          activeRenderHandler = readFrame
          activeZoomEndHandler = finishLeg
          mapRef.on("render", activeRenderHandler)
          mapRef.once("zoomend", activeZoomEndHandler)
          mapRef.easeTo({ zoom: leg.endZoom, duration: 1_600, essential: true })
        }

        timeoutId = window.setTimeout(() => finish(true), 10_000)
        startLeg(0)
      }),
    { sampledThreshold: threshold, legs: FOG_ZOOM_LEGS }
  )
}

async function runFogZoomJitterCheck(app: AppPage, testInfo: TestInfo) {
  let artifact: FogZoomArtifact = {
    version: 1,
    threshold: null,
    frames: [],
    samples: [],
    diagnostics: null,
  }

  try {
    await prepareFogVisual(app, false)
    await app.page.evaluate((initialZoom) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      map.jumpTo({ center: [13.45, 52.5], zoom: initialZoom })
    }, FOG_ZOOM_MIN)
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
    const threshold = (exploredLuminance + coveredLuminance) / 2
    const readings = await readFogZoomSamples(app.page, threshold)
    const diagnostics = readFogZoomDiagnostics(readings)
    artifact = {
      version: 1,
      threshold: roundFogZoomValue(threshold),
      frames: readings.frames.map(compactFogZoomFrame),
      samples: readings.samples.map(compactFogZoomSample),
      diagnostics,
    }

    const exceededDirection = (["combined", "in", "out"] as const).find(
      (direction) => {
        const excursion = diagnostics.excursions[direction].excursion
        return excursion !== null && excursion > FOG_ZOOM_MAX_EXCURSION
      }
    )
    if (exceededDirection) {
      const excursion = diagnostics.excursions[exceededDirection].excursion!
      throw new Error(
        `Fog edge excursion was ${excursion.toFixed(3)} CSS px for ${exceededDirection}; diagnostics: ${JSON.stringify(diagnostics)}`
      )
    }

    const invalidRetainedFrame = readings.frames.find(
      (frame) =>
        frame.usable &&
        (!frame.centerDetected ||
          !frame.leftEdgeDetected ||
          !frame.rightEdgeDetected)
    )
    if (invalidRetainedFrame) {
      throw new Error(
        `Fog zoom detector retained a frame without center and edge detections; diagnostics: ${JSON.stringify(diagnostics)}`
      )
    }
    if (readings.timedOut) {
      throw new Error(
        `Fog zoom sampler timed out before completing its bounded legs; diagnostics: ${JSON.stringify(diagnostics)}`
      )
    }
    if (readings.samples.length === 0) {
      throw new Error(
        `Fog zoom detector found no usable frames; diagnostics: ${JSON.stringify(diagnostics)}`
      )
    }
    if (!diagnostics.zoom.sufficient) {
      throw new Error(
        `Fog zoom sample coverage was insufficient; diagnostics: ${JSON.stringify(diagnostics)}`
      )
    }
  } catch (error) {
    artifact = { ...artifact, error: describeFogZoomError(error) }
    throw error
  } finally {
    await testInfo.attach("fog-zoom-samples.json", {
      body: Buffer.from(JSON.stringify(artifact)),
      contentType: "application/json",
    })
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
  }, testInfo) => {
    await runFogZoomJitterCheck(app, testInfo)
  })
})

test.describe("positive fog mask zoom stability at DPR 2", () => {
  test.use({ deviceScaleFactor: 2 })

  test("[F-039] keeps the corridor edge locked during animated zoom", async ({
    app,
  }, testInfo) => {
    await runFogZoomJitterCheck(app, testInfo)
  })
})
