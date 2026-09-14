import { expect, test } from "../fixtures/app"
import type { Locator, Page } from "@playwright/test"
import { waitForMapIdle } from "../fixtures/performance"

function hasNonZeroBlur(filter: string): boolean {
  const match = /blur\(\s*([0-9]*\.?[0-9]+)(?:[a-z%]+)?\s*\)/i.exec(filter)
  return match !== null && Number(match[1]) > 0
}

async function readBackdropFilter(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const styles = window.getComputedStyle(element)
    return (
      styles.backdropFilter ||
      styles.getPropertyValue("-webkit-backdrop-filter")
    )
  })
}

async function findUnobstructedMapPoint(
  page: Page
): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")
    if (!canvas) throw new Error("Map canvas is not visible")

    const bounds = canvas.getBoundingClientRect()
    const candidates = [
      [0.08, 0.5],
      [0.2, 0.5],
      [0.35, 0.5],
      [0.08, 0.75],
      [0.35, 0.75],
      [0.5, 0.75],
    ] as const
    for (const [xFraction, yFraction] of candidates) {
      const x = bounds.left + bounds.width * xFraction
      const y = bounds.top + bounds.height * yFraction
      if (document.elementFromPoint(x, y) === canvas) return { x, y }
    }

    throw new Error("Could not find an unobstructed portion of the map canvas")
  })
}

test("preserves overlay blur while the map is moving", async ({
  app,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 900 })
  await app.goto()
  await app.importActivities(1)
  await app.waitForImportToSettle()

  const activity = (await app.localActivities()).find(
    (item) => item.name === "t1.gpx"
  )
  if (!activity) throw new Error("blur regression activity was not imported")

  await app.page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
  await app.waitUntilReady()
  await waitForMapIdle(app.page)

  const activityTitle = app.page.getByText(activity.name, { exact: true })
  const activityCard = activityTitle.locator(
    'xpath=ancestor::*[@data-slot="card"][1]'
  )
  const controlsSurface = app.page.getByRole("button", {
    name: "Open controls",
  })
  await expect(activityTitle).toBeVisible()
  await expect(activityCard).toBeVisible()
  await expect(controlsSurface).toBeVisible()

  const restingActivityFilter = await readBackdropFilter(activityCard)
  expect(hasNonZeroBlur(restingActivityFilter)).toBe(true)

  const start = await findUnobstructedMapPoint(app.page)
  await app.page.mouse.move(start.x, start.y)
  await app.page.mouse.down()
  try {
    await app.page.mouse.move(start.x + 280, start.y + 80, { steps: 12 })
    await expect
      .poll(
        () => app.page.locator("[data-map-cache][data-map-moving]").count(),
        { message: "MapLibre did not enter the moving state" }
      )
      .toBe(1)

    const movingActivityFilter = await readBackdropFilter(activityCard)
    expect(hasNonZeroBlur(movingActivityFilter)).toBe(true)

    const movingControlsFilter = await readBackdropFilter(controlsSurface)
    expect(hasNonZeroBlur(movingControlsFilter)).toBe(true)
  } finally {
    await app.page.mouse.up()
  }

  await waitForMapIdle(app.page)
  await expect(
    app.page.locator("[data-map-cache][data-map-moving]")
  ).toHaveCount(0)

  const settledActivityFilter = await readBackdropFilter(activityCard)
  const settledControlsFilter = await readBackdropFilter(controlsSurface)
  expect(hasNonZeroBlur(settledActivityFilter)).toBe(true)
  expect(hasNonZeroBlur(settledControlsFilter)).toBe(true)
})
