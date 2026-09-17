import { expect, test, type Page, type TestInfo } from "@playwright/test"
import {
  diffPerformanceCounters,
  makePerformanceActivities,
  readPerformanceCounters,
  sampleMapGesture,
  seedPerformanceDatabase,
  waitForMapIdle,
} from "../fixtures/performance"
import {
  installTrailTiles,
  TRAIL_TEST_CENTER,
  TRAIL_TEST_ZOOM,
} from "../fixtures/trails-maptoolkit"

const OFFLINE_STYLE = {
  version: 8,
  name: "e2e-map-performance",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0a1e" } },
  ],
}

type TrailPerformanceMode = "trails-off" | "trails-on"

interface TrailPerformanceFixture {
  mode: TrailPerformanceMode
  requests: string[]
}

async function stubMapTiles(
  page: Page,
  trailMode?: TrailPerformanceMode
): Promise<TrailPerformanceFixture> {
  await page.route("https://tiles.openfreemap.org/**", (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OFFLINE_STYLE),
      })
    }
    return route.abort()
  })
  await page.route("https://server.arcgisonline.com/**", (route) =>
    route.abort()
  )
  await page.route("https://s3.amazonaws.com/**", (route) => route.abort())

  const tiles = await installTrailTiles(page)
  return {
    mode: trailMode ?? "trails-off",
    get requests() {
      return trailMode
        ? tiles.requests
            .filter((request) => request.kind === "tile")
            .map((request) => request.url)
        : []
    },
  }
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Open controls" })).toBeVisible(
    { timeout: 45_000 }
  )
  await page.waitForFunction(() => {
    const map = window.__fogofwalkE2eMap
    return Boolean(map && window.__fogofwalkE2eMapStore?.sourcesReady)
  })
  await waitForMapIdle(page)
  await page.waitForFunction(() => {
    const counters = window.__fogofwalkE2ePerformanceCounters
    if (!counters) return false
    return new Promise<boolean>((resolve) => {
      let previous = counters.mapRouteCommits ?? 0
      let stableFrames = 0
      const check = () => {
        const current = counters.mapRouteCommits ?? 0
        if (current === previous) stableFrames++
        else {
          previous = current
          stableFrames = 0
        }
        if (stableFrames >= 5) resolve(true)
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
  })
}

async function setMapSwitch(
  page: Page,
  name: string,
  value: boolean
): Promise<void> {
  const drawer = page.locator('[data-vaul-drawer][data-state="open"]')
  const openControls = page.getByRole("button", { name: "Open controls" })
  if (!(await drawer.isVisible().catch(() => false))) await openControls.click()
  await expect(drawer).toBeVisible()
  const toggle = drawer.getByRole("switch", { name })
  const isChecked = (await toggle.getAttribute("data-checked")) !== null
  if (isChecked !== value) await toggle.click()
  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
  await expect(page.locator("[data-vaul-overlay]")).toHaveCount(0)
}

async function resetMapPresentation(page: Page): Promise<void> {
  await setMapSwitch(page, "Show activities", true)
  await setMapSwitch(page, "Show fog", true)
}

async function reportMetrics(
  testInfo: TestInfo,
  reports: unknown[],
  label: string,
  metrics: unknown
): Promise<void> {
  const report = { label, metrics }
  reports.push(report)
  console.log(JSON.stringify(report))
  await testInfo.attach(`map-${label.replace(/[^a-z0-9]+/gi, "-")}`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  })
}

function expectNoMapDataWork(
  delta: ReturnType<typeof diffPerformanceCounters>
): void {
  expect(delta.homeLoaderStarts).toBe(0)
  expect(delta.fullActivityLoads).toBe(0)
  expect(delta.uniqueDistanceWorkerRequests).toBe(0)
  expect(delta.fogWorkerRebuildRequests).toBe(0)
  expect(delta.fogWorkerAppendRequests).toBe(0)
  expect(delta.mapSourceSetDataCalls).toBe(0)
  expect(delta.activityPaintUpdates).toBe(0)
  expect(delta.mapUiNavigations).toBe(0)
  expect(delta.idbGetAllCalls.activities ?? 0).toBe(0)
  expect(delta.idbGetCalls.activities ?? 0).toBe(0)
  expect(delta.idbGetAllCalls.photos ?? 0).toBe(0)
  expect(delta.idbGetAllCalls["saved-points"] ?? 0).toBe(0)
}

test.describe("map interaction performance fixture", () => {
  test.describe.configure({ mode: "serial" })

  test("compares trail-enabled and trail-disabled gesture metrics", async ({
    browser,
  }, testInfo) => {
    const reports: unknown[] = []
    const measurements: {
      mode: TrailPerformanceMode
      requests: number
      metrics: Awaited<ReturnType<typeof sampleMapGesture>>
    }[] = []

    for (const mode of ["trails-off", "trails-on"] as const) {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1280, height: 900 },
      })
      const page = await context.newPage()
      try {
        const fixture = await stubMapTiles(page, mode)
        await seedPerformanceDatabase(
          page,
          makePerformanceActivities(1, "compact"),
          true
        )
        await page.goto("/map")
        await waitForMapReady(page)
        if (mode === "trails-off") {
          await setMapSwitch(page, "Show trails", false)
        }
        await page.evaluate(
          ({ center, zoom }) => {
            const map = window.__fogofwalkE2eMap
            if (!map) throw new Error("MapLibre test handle is unavailable")
            map.jumpTo({ center, zoom })
          },
          { center: TRAIL_TEST_CENTER, zoom: TRAIL_TEST_ZOOM }
        )
        if (mode === "trails-on") {
          await expect
            .poll(() => fixture.requests.length, { timeout: 20_000 })
            .toBeGreaterThan(0)
        } else {
          expect(fixture.requests).toHaveLength(0)
        }

        const metrics = await sampleMapGesture(page)
        measurements.push({ mode, requests: fixture.requests.length, metrics })
        await reportMetrics(testInfo, reports, `trails-${mode}`, {
          mode,
          tileRequests: fixture.requests.length,
          ...metrics,
        })
      } finally {
        await context.close()
      }
    }

    expect(measurements).toHaveLength(2)
    expect(
      measurements.find(({ mode }) => mode === "trails-off")?.requests
    ).toBe(0)
    expect(
      measurements.find(({ mode }) => mode === "trails-on")?.requests
    ).toBeGreaterThan(0)
    const disabled = measurements.find(({ mode }) => mode === "trails-off")
    const enabled = measurements.find(({ mode }) => mode === "trails-on")
    if (!disabled || !enabled)
      throw new Error("Trail performance measurements missing")
    await reportMetrics(testInfo, reports, "trails-off-vs-on", {
      disabled: disabled.metrics,
      enabled: enabled.metrics,
      comparison: {
        maxFrameGapDelta:
          (enabled.metrics.maxFrameGap ?? 0) -
          (disabled.metrics.maxFrameGap ?? 0),
        longTaskCountDelta:
          enabled.metrics.longTasks.length - disabled.metrics.longTasks.length,
      },
    })
  })

  for (const dataset of [
    { count: 100, kind: "compact" as const },
    { count: 500, kind: "dense" as const },
    { count: 2_000, kind: "compact" as const },
  ]) {
    test(`${dataset.kind} ${dataset.count} activities`, async ({
      page,
    }, testInfo) => {
      await stubMapTiles(page)
      await page.setViewportSize({ width: 1280, height: 900 })
      const activities = makePerformanceActivities(dataset.count, dataset.kind)
      await seedPerformanceDatabase(page, activities, true)
      await page.goto("/map")
      await waitForMapReady(page)

      const reports: unknown[] = []
      const baseline = await readPerformanceCounters(page)
      const canvas = page.locator(".maplibregl-canvas").first()
      const canvasBounds = await canvas.boundingBox()
      if (!canvasBounds) throw new Error("Map canvas is not visible")
      const baselineUrl = page.url()
      for (let click = 0; click < 3; click++) {
        await page.mouse.click(
          canvasBounds.x + canvasBounds.width * 0.08,
          canvasBounds.y + canvasBounds.height * 0.08
        )
      }
      await page.waitForTimeout(100)
      const emptyClickDelta = diffPerformanceCounters(
        baseline,
        await readPerformanceCounters(page)
      )
      expect(page.url()).toBe(baselineUrl)
      expectNoMapDataWork(emptyClickDelta)
      expect(emptyClickDelta.mapRouteCommits).toBe(0)
      expect(emptyClickDelta.mapDialogCommits).toBe(0)
      await reportMetrics(testInfo, reports, "empty-click-no-dialog", {
        observedPostFixBaseline: emptyClickDelta,
        prePhase2ExpectedHomeLoaderStarts: ">=1",
      })

      for (const variant of [
        { name: "activities-on-fog-on", activities: true, fog: true },
        { name: "activities-on-fog-off", activities: true, fog: false },
        { name: "activities-off-fog-on", activities: false, fog: true },
        { name: "activities-off-fog-off", activities: false, fog: false },
      ]) {
        await setMapSwitch(page, "Show activities", variant.activities)
        await setMapSwitch(page, "Show fog", variant.fog)
        const metrics = await sampleMapGesture(page)
        expect(metrics.finalCenter).not.toEqual(metrics.initialCenter)
        await reportMetrics(
          testInfo,
          reports,
          `${dataset.kind}-${dataset.count}-${variant.name}`,
          {
            commit: process.env.GITHUB_SHA ?? "working-tree",
            browser: testInfo.project.name,
            viewport: { width: 1280, height: 900 },
            hardwareConcurrency: await page.evaluate(
              () => navigator.hardwareConcurrency
            ),
            dataset: {
              count: dataset.count,
              kind: dataset.kind,
              pointCount: activities.reduce(
                (sum, activity) => sum + activity.coordinates.length,
                0
              ),
              featureCount: activities.length,
            },
            cpuThrottling: false,
            variant,
            ...metrics,
          }
        )
      }

      await resetMapPresentation(page)
      await page.goto(`/map?activity=${encodeURIComponent(activities[0]!.id)}`)
      await waitForMapReady(page)
      await expect(
        page.getByRole("button", { name: "Close" }).first()
      ).toBeVisible({ timeout: 30_000 })
      const openDialogMetrics = await sampleMapGesture(page)
      expect(openDialogMetrics.finalCenter).not.toEqual(
        openDialogMetrics.initialCenter
      )
      await reportMetrics(
        testInfo,
        reports,
        `${dataset.kind}-${dataset.count}-activity-dialog-open`,
        openDialogMetrics
      )

      const beforeActivityClose = await readPerformanceCounters(page)
      await page.getByRole("button", { name: "Close" }).first().click()
      await expect(page).toHaveURL(/\/map$/)
      const activityCloseDelta = diffPerformanceCounters(
        beforeActivityClose,
        await readPerformanceCounters(page)
      )
      expect(activityCloseDelta.homeLoaderStarts).toBe(0)
      expect(activityCloseDelta.fullActivityLoads).toBe(0)
      expect(activityCloseDelta.uniqueDistanceWorkerRequests).toBe(0)
      expect(activityCloseDelta.fogWorkerRebuildRequests).toBe(0)
      expect(activityCloseDelta.fogWorkerAppendRequests).toBe(0)
      expect(activityCloseDelta.mapUiNavigations).toBe(1)
      const closedDialogMetrics = await sampleMapGesture(page)
      expect(closedDialogMetrics.finalCenter).not.toEqual(
        closedDialogMetrics.initialCenter
      )
      await reportMetrics(
        testInfo,
        reports,
        `${dataset.kind}-${dataset.count}-activity-dialog-closed`,
        closedDialogMetrics
      )

      await testInfo.attach("map-performance-report.json", {
        body: Buffer.from(
          JSON.stringify(
            {
              commit: process.env.GITHUB_SHA ?? "working-tree",
              browser: testInfo.project.name,
              dataset,
              reports,
            },
            null,
            2
          )
        ),
        contentType: "application/json",
      })
    })
  }

  test("records a mobile-size touch pan and rotate gesture", async ({
    page,
  }, testInfo) => {
    await stubMapTiles(page)
    await page.setViewportSize({ width: 390, height: 844 })
    const activities = makePerformanceActivities(100, "compact")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/map")
    await waitForMapReady(page)
    const metrics = await sampleMapGesture(page, {
      input: "touch",
      rotate: true,
    })
    expect(metrics.finalCenter).not.toEqual(metrics.initialCenter)
    expect(
      Math.abs(metrics.finalBearing - metrics.initialBearing)
    ).toBeGreaterThan(1)
    await reportMetrics(testInfo, [], "mobile-touch-pan-rotate", {
      commit: process.env.GITHUB_SHA ?? "working-tree",
      browser: testInfo.project.name,
      viewport: { width: 390, height: 844 },
      hardwareConcurrency: await page.evaluate(
        () => navigator.hardwareConcurrency
      ),
      dataset: {
        count: activities.length,
        kind: "compact",
        pointCount: activities.reduce(
          (sum, activity) => sum + activity.coordinates.length,
          0
        ),
        featureCount: activities.length,
      },
      cpuThrottling: false,
      ...metrics,
    })
  })

  test("coalesces desktop dialog pointer moves", async ({ page }) => {
    await stubMapTiles(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    const activity = makePerformanceActivities(1, "compact")[0]!
    await seedPerformanceDatabase(page, [activity], true)
    await page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
    await waitForMapReady(page)

    const card = page.locator('[data-slot="card"]').first()
    const handle = card.locator('[data-slot="card-header"]')
    await expect(handle).toBeVisible()
    await waitForMapIdle(page)
    const draggable = card.locator("xpath=..")
    const beforeBox = await draggable.boundingBox()
    const handleBox = await handle.boundingBox()
    if (!beforeBox || !handleBox)
      throw new Error("Activity dialog is not laid out")

    const initialCenter = await page.evaluate(() => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      const center = (
        map as unknown as { getCenter: () => { lng: number; lat: number } }
      ).getCenter()
      return [center.lng, center.lat]
    })
    const beforeCounters = await readPerformanceCounters(page)

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    )
    await page.mouse.down()
    const pointerId = await page.evaluate(() => {
      const handle = document.querySelector('[data-slot="card-header"]')
      if (!(handle instanceof HTMLElement)) {
        throw new Error("Activity dialog handle is unavailable")
      }
      for (let candidate = 1; candidate <= 8; candidate++) {
        if (handle.hasPointerCapture(candidate)) return candidate
      }
      throw new Error("Dialog did not capture the pointer")
    })
    await page.evaluate(
      ({ pointerId, handleBox }) => {
        const handle = document.querySelector('[data-slot="card-header"]')
        if (!(handle instanceof HTMLElement)) {
          throw new Error("Activity dialog handle is unavailable")
        }
        const endX = 0
        const endY = window.innerHeight
        for (let index = 1; index <= 240; index++) {
          const progress = index / 240
          handle.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              cancelable: true,
              pointerId,
              pointerType: "mouse",
              isPrimary: true,
              clientX:
                handleBox.x +
                handleBox.width / 2 -
                (handleBox.x + handleBox.width / 2 - endX) * progress,
              clientY:
                handleBox.y +
                handleBox.height / 2 +
                (endY - (handleBox.y + handleBox.height / 2)) * progress,
              buttons: 1,
            })
          )
        }
        handle.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "mouse",
            isPrimary: true,
            clientX: endX,
            clientY: endY,
            buttons: 0,
          })
        )
      },
      { pointerId, handleBox }
    )
    await page.mouse.up()
    await waitForMapIdle(page)

    const afterCounters = await readPerformanceCounters(page)
    const delta = diffPerformanceCounters(beforeCounters, afterCounters)
    const afterBox = await draggable.boundingBox()
    if (!afterBox) throw new Error("Activity dialog disappeared after drag")
    expect(delta.draggableTransformWrites).toBeGreaterThan(0)
    expect(delta.draggableTransformWrites).toBeLessThan(20)
    expect(afterBox.x).toBeGreaterThanOrEqual(12)
    expect(afterBox.y).toBeGreaterThanOrEqual(12)
    expect(afterBox.x + afterBox.width).toBeLessThanOrEqual(1280 - 12)
    expect(afterBox.y + afterBox.height).toBeLessThanOrEqual(900 - 12)

    const finalCenter = await page.evaluate(() => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      const center = (
        map as unknown as { getCenter: () => { lng: number; lat: number } }
      ).getCenter()
      return [center.lng, center.lat]
    })
    expect(finalCenter).toEqual(initialCenter)
    expect(afterBox.x !== beforeBox.x || afterBox.y !== beforeBox.y).toBe(true)
  })
})
