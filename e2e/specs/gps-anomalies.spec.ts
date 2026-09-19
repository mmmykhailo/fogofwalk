import { expect, test } from "../fixtures/app"
import {
  makeGpsAnomalyGpx,
  makeGpsGapIslandGpx,
  makeGpsRecordingGapGpx,
  makeGpsRecoveredFragmentGpx,
} from "../fixtures/gpx"

interface GeometrySource {
  getData?: () => Promise<{
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown }
    }>
  }>
}

interface FogData {
  features: Array<{
    geometry?:
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] }
  }>
}

async function readFogData(
  page: import("@playwright/test").Page
): Promise<FogData | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const entry = await new Promise<any>((resolve) => {
      const transaction = db.transaction("prefs", "readonly")
      const request = transaction.objectStore("prefs").get("fogCache")
      request.onsuccess = () => resolve(request.result?.value ?? null)
      request.onerror = () => resolve(null)
    })
    db.close()
    return entry?.fogData ?? null
  })
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [x, y] = ring[index] ?? []
    const [previousX, previousY] = ring[previous] ?? []
    if (x == null || y == null || previousX == null || previousY == null) {
      continue
    }
    const crosses =
      y > point[1] !== previousY > point[1] &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x
    if (crosses) inside = !inside
  }
  return inside
}

function pointInPolygon(
  point: [number, number],
  polygon: number[][][]
): boolean {
  const [shell, ...holes] = polygon
  return (
    shell != null &&
    pointInRing(point, shell) &&
    holes.every((hole) => !pointInRing(point, hole))
  )
}

function isExplored(fogData: FogData, point: [number, number]): boolean {
  return fogData.features.some((feature) => {
    const geometry = feature.geometry
    if (!geometry) return false
    return geometry.type === "Polygon"
      ? pointInPolygon(point, geometry.coordinates)
      : geometry.coordinates.some((polygon) => pointInPolygon(point, polygon))
  })
}

function longitudeForMeters(
  originLng: number,
  latitude: number,
  xM: number
): number {
  return originLng + xM / (111_195 * Math.cos((latitude * Math.PI) / 180))
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

test("stores a recording pause as disconnected paths with zero removed points", async ({
  app,
}) => {
  const fixture = makeGpsRecordingGapGpx()

  await app.goto()
  await app.importFiles([fixture])
  await app.waitForImportToSettle()
  await app.expectActivityCount(1)

  const stored = await readActivity(app.page, fixture.name)
  expect(stored.paths).toEqual([
    [
      [13.41, 52.5],
      [13.4101, 52.5],
      [13.4102, 52.5],
      [13.4103, 52.5],
      [13.4104, 52.5],
      [13.4105, 52.5],
    ],
    [
      [13.4106, 52.5],
      [13.4107, 52.5],
    ],
  ])
  expect(stored.stats.distanceKm).toBeLessThan(0.2)
  expect(stored.stats.durationMs).toBe(51_000)
})

test("removes a GPX gap island while preserving later timestamps and fog topology", async ({
  app,
}) => {
  const consoleMessages: string[] = []
  app.page.on("console", (message) => consoleMessages.push(message.text()))
  const fixture = makeGpsGapIslandGpx()

  await app.goto()
  await app.importFiles([fixture])
  await app.waitForImportToSettle()
  const stored = await readActivity(app.page, fixture.name)

  expect(stored.paths.map((path: unknown[]) => path.length)).toEqual([7, 5])
  expect(stored.coordinates).toHaveLength(12)
  expect(stored.pathTimestamps.map((path: unknown[]) => path.length)).toEqual([
    7, 5,
  ])
  expect(stored.pathTimestamps[1][0]).toBeGreaterThan(
    stored.pathTimestamps[0][stored.pathTimestamps[0].length - 1]
  )

  const activityGeometry = await app.page.evaluate(async () => {
    const source = window.__fogofwalkE2eMap?.getSource("activities-source") as
      | GeometrySource
      | undefined
    return source?.getData ? source.getData() : null
  })
  expect(activityGeometry?.features?.[0]?.geometry).toMatchObject({
    type: "MultiLineString",
  })
  const activityCoordinates = activityGeometry?.features?.[0]?.geometry
    ?.coordinates as unknown[][][] | undefined
  expect(activityCoordinates?.map((path) => path.length)).toEqual([7, 5])

  await expect
    .poll(() => app.fogCacheSummary())
    .toMatchObject({ ringCount: expect.any(Number) })
  expect((await app.fogCacheSummary())?.ringCount).toBeGreaterThan(0)
  const fogData = await readFogData(app.page)
  expect(fogData).not.toBeNull()
  for (const xM of [756.45, 673.25]) {
    expect(
      isExplored(fogData!, [longitudeForMeters(13.6, 52.5, xM), 52.5])
    ).toBe(false)
  }

  await app.page.goto(`/map?activity=${encodeURIComponent(stored.id)}`)
  await app.waitUntilReady()
  await app.page.getByRole("button", { name: "Share" }).click()
  const shareDialog = app.page.getByRole("dialog", { name: "Share activity" })
  await expect(shareDialog).toBeVisible()
  await expect(app.page.getByText("Rendering map…")).toBeHidden({
    timeout: 30_000,
  })
  const shareGeometry = await app.page.evaluate(
    () => window.__fogofwalkE2eShareGeometry ?? null
  )
  expect(shareGeometry).toMatchObject({ type: "MultiLineString" })
  expect(
    (shareGeometry as { coordinates?: unknown[][][] } | null)?.coordinates?.map(
      (path) => path.length
    )
  ).toEqual([7, 5])
  await app.page.keyboard.press("Escape")

  const diagnostics = consoleMessages.join("\n")
  expect(diagnostics).toMatch(/isolated_fix/)
  expect(diagnostics).toMatch(/removedPoints.*1/)
  expect(diagnostics).not.toMatch(/untrusted_suffix/)
  expect(diagnostics).not.toContain("coordinates")
})

test("recovers the reliable GPX fragment after a discontinuity", async ({
  app,
}) => {
  const consoleMessages: string[] = []
  app.page.on("console", (message) => consoleMessages.push(message.text()))
  const fixture = makeGpsRecoveredFragmentGpx()

  await app.goto()
  await app.importFiles([fixture])
  await app.waitForImportToSettle()
  const stored = await readActivity(app.page, fixture.name)

  expect(stored.paths.map((path: unknown[]) => path.length)).toEqual([6, 5])
  expect(stored.coordinates).toHaveLength(11)
  expect(stored.pathTimestamps.flat().at(-1)).toBeGreaterThan(
    stored.pathTimestamps[0].at(-1)
  )
  expect(stored.pathTimestamps).toHaveLength(2)
  expect(stored.stats.durationMs).toBe(2_114_000)
  expect(stored.stats.distanceKm).toBeLessThan(0.2)

  const diagnostics = consoleMessages.join("\n")
  expect(diagnostics).toMatch(/recovered_fragment/)
  expect(diagnostics).not.toMatch(/untrusted_suffix/)
  expect(diagnostics).toMatch(/retainedPoints.*11/)
  expect(diagnostics).toMatch(/removedPoints.*2/)
  expect(diagnostics).not.toContain("coordinates")
})
