import { expect, test, type Page, type TestInfo } from "@playwright/test"
import {
  diffPerformanceCounters,
  makePerformanceActivities,
  readPerformanceCounters,
  sampleMapGesture,
  seedPerformanceDatabase,
  waitForMapIdle,
} from "../fixtures/performance"

const OFFLINE_STYLE = {
  version: 8,
  name: "e2e-map-performance",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0a1e" } },
  ],
}

async function stubMapTiles(page: Page) {
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
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Open controls" })).toBeVisible(
    { timeout: 45_000 }
  )
  await page.waitForFunction(() => {
    const map = window.__fogofwalkE2eMap
    return Boolean(map && window.__fogofwalkE2eMapStore?.sourcesReady)
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

test.describe("map interaction performance fixture", () => {
  test.describe.configure({ mode: "serial" })

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
      await page.mouse.click(
        canvasBounds.x + canvasBounds.width * 0.08,
        canvasBounds.y + canvasBounds.height * 0.08
      )
      await expect
        .poll(async () => {
          const current = await readPerformanceCounters(page)
          return diffPerformanceCounters(baseline, current).homeLoaderStarts
        })
        .toBeGreaterThanOrEqual(1)

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

      await page.getByRole("button", { name: "Close" }).first().click()
      await expect(page).toHaveURL(/\/map$/)
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
    await reportMetrics(testInfo, [], "mobile-touch-pan-rotate", metrics)
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
