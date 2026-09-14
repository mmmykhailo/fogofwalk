import { expect, test } from "../fixtures/app"
import { makeGpsAnomalyGpx } from "../fixtures/gpx"

interface GeometrySource {
  getData?: () => Promise<{
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown }
    }>
  }>
}

async function readActivity(
  page: import("@playwright/test").Page,
  name: string
) {
  return page.evaluate(async (activityName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const activity = await new Promise<any>((resolve, reject) => {
      const transaction = db.transaction("activities", "readonly")
      const request = transaction.objectStore("activities").getAll()
      request.onsuccess = () =>
        resolve(request.result.find((item: any) => item.name === activityName))
      request.onerror = () => reject(request.error)
    })
    db.close()
    return activity ?? null
  }, name)
}

test("cleans one anomalous activity without bridging its retained paths", async ({
  app,
}) => {
  const consoleMessages: string[] = []
  app.page.on("console", (message) => {
    consoleMessages.push(message.text())
  })
  const fixture = makeGpsAnomalyGpx()

  await app.goto()
  await app.importFiles([fixture])
  await app.waitForImportToSettle()
  await app.expectActivityCount(1)

  const stored = await readActivity(app.page, fixture.name)
  expect(stored).not.toBeNull()
  expect(stored.paths).toEqual([
    [
      [13.4, 52.5],
      [13.4001, 52.5],
      [13.4002, 52.5],
      [13.4003, 52.5],
      [13.4004, 52.5],
    ],
    [
      [13.4005, 52.5],
      [13.4006, 52.5],
      [13.4007, 52.5],
      [13.4008, 52.5],
    ],
  ])
  expect(stored.pathTimestamps).toHaveLength(2)
  expect(stored.pathTimestamps.map((path: unknown[]) => path.length)).toEqual([
    5, 4,
  ])
  expect(stored.pointTimestamps).toHaveLength(9)
  expect(stored.coordinates).not.toContainEqual([23.4, 52.5])
  expect(stored.stats.distanceKm).toBeGreaterThan(0)
  expect(stored.stats.distanceKm).toBeLessThan(0.2)

  const mainGeometry = await app.page.evaluate(async () => {
    const source = window.__fogofwalkE2eMap?.getSource("activities-source") as
      | GeometrySource
      | undefined
    return source?.getData ? source.getData() : null
  })
  expect(mainGeometry?.features?.[0]?.geometry).toMatchObject({
    type: "MultiLineString",
    coordinates: [
      [
        [13.4, 52.5],
        [13.4001, 52.5],
        [13.4002, 52.5],
        [13.4003, 52.5],
        [13.4004, 52.5],
      ],
      [
        [13.4005, 52.5],
        [13.4006, 52.5],
        [13.4007, 52.5],
        [13.4008, 52.5],
      ],
    ],
  })

  const activity = (await app.localActivities()).find(
    (item) => item.name === fixture.name
  )
  if (!activity) throw new Error("cleaned activity was not persisted")

  await app.page.goto("/map")
  await app.waitUntilReady()
  await app.page.evaluate(() => {
    window.__fogofwalkE2eMap?.jumpTo({
      center: [13.4004, 52.5],
      zoom: 16,
    })
  })
  await app.page.waitForTimeout(250)

  await app.clickMapCoordinate([13.4002, 52.5])
  await expect(
    app.page.getByRole("button", { name: "Delete activity" })
  ).toBeVisible()
  const center = await app.page.evaluate(() =>
    window.__fogofwalkE2eMap?.getCenter()
  )
  expect(center?.lng).toBeCloseTo(13.4004, 2)
  expect(center?.lat).toBeCloseTo(52.5, 2)

  await app.page.getByRole("button", { name: "Share" }).click()
  const shareDialog = app.page.getByRole("dialog", { name: "Share activity" })
  await expect(shareDialog).toBeVisible()
  await expect(app.page.getByText("Rendering map…")).toBeHidden({
    timeout: 30_000,
  })
  expect(
    await app.page.evaluate(() => window.__fogofwalkE2eShareGeometry ?? null)
  ).toMatchObject({
    type: "MultiLineString",
    coordinates: [
      [
        [13.4, 52.5],
        [13.4001, 52.5],
        [13.4002, 52.5],
        [13.4003, 52.5],
        [13.4004, 52.5],
      ],
      [
        [13.4005, 52.5],
        [13.4006, 52.5],
        [13.4007, 52.5],
        [13.4008, 52.5],
      ],
    ],
  })

  const diagnosticText = consoleMessages.join("\n")
  expect(diagnosticText).toMatch(/inputPoints.*10/)
  expect(diagnosticText).toMatch(/retainedPoints.*9/)
  expect(diagnosticText).toMatch(/removedPoints.*1/)
  expect(diagnosticText).not.toContain("23.4")
  expect(diagnosticText).not.toContain("coordinates")

  await app.page.keyboard.press("Escape")
  await app.reload()
  const reloaded = await readActivity(app.page, fixture.name)
  expect(reloaded.paths).toEqual(stored.paths)
  expect(reloaded.pathTimestamps).toEqual(stored.pathTimestamps)
  expect(reloaded.stats.distanceKm).toBe(stored.stats.distanceKm)

  await app.importFiles([fixture])
  const duplicateDialog = app.page.getByRole("dialog", {
    name: /Activit(?:y|ies) already added/,
  })
  await expect(duplicateDialog).toBeVisible()
  await expect(duplicateDialog).toContainText("already on your map")
  await app.page.keyboard.press("Escape")
  await expect(duplicateDialog).toBeHidden()
  await app.expectActivityCount(1)

  expect(activity.id).toBe(reloaded.id)
})
