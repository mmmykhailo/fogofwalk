import { test, expect } from "../fixtures/app"
import type { AppPage } from "../fixtures/app-page"
import {
  diffPerformanceCounters,
  installPerformanceCounters,
  readPerformanceCounters,
  waitForMapIdle,
} from "../fixtures/performance"

const PHOTO_ID = "e2e-map-dismissal-photo"
const PHOTO_COORDINATE: [number, number] = [13.45, 52.55]
const PHOTO_TAKEN_AT = Date.UTC(2024, 0, 2, 8, 0, 0)

const SAVED_POINT_ID = "e2e-map-dismissal-point"
const SAVED_POINT_COORDINATE: [number, number] = [13.4595, 52.5576]
const SAVED_POINT_NAME = "E2E dismissal point"

const PUBLIC_POINT_ID = "e2e-map-dismissal-public-point"
const PUBLIC_POINT_NAME = "E2E public dismissal point"
const PUBLIC_POINT = {
  id: PUBLIC_POINT_ID,
  name: PUBLIC_POINT_NAME,
  description: "A public point for map dismissal coverage.",
  lng: 13.8,
  lat: 52.8,
  color: "purple" as const,
  isPublic: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

const PUBLIC_POINT_B = {
  ...PUBLIC_POINT,
  id: "e2e-map-dismissal-public-point-b",
  name: "E2E public dismissal point B",
  lng: 14.1,
  lat: 52.9,
}

async function pushSavedPointQuery(app: AppPage, id: string) {
  await app.page.evaluate((savedPointId) => {
    const currentState =
      typeof history.state === "object" && history.state !== null
        ? history.state
        : {}
    const currentIndex =
      typeof currentState.idx === "number" ? currentState.idx : 0
    const targetKey = Math.random().toString(36).slice(2, 10)
    return new Promise<void>((resolve) => {
      const onPopState = () => {
        if (history.state?.key === targetKey) {
          window.removeEventListener("popstate", onPopState)
          resolve()
          return
        }
        history.go(1)
      }
      window.addEventListener("popstate", onPopState)
      history.pushState(
        { ...currentState, idx: currentIndex + 1, key: targetKey },
        "",
        `/map?savedPoint=${encodeURIComponent(savedPointId)}`
      )
      history.go(-1)
    })
  }, id)
}

function expectNoDismissalWork(
  delta: ReturnType<typeof diffPerformanceCounters>,
  expectedNavigations: number,
  expectedSourceUpdates = 0,
  expectedPaintUpdates = 0
) {
  expect(delta.homeLoaderStarts).toBe(0)
  expect(delta.homeBootstrapStarts).toBe(0)
  expect(delta.homeBootstrapCompletions).toBe(0)
  expect(delta.fullActivityLoads).toBe(0)
  expect(delta.activitySummaryReads).toBe(0)
  expect(delta.photoStoreReads).toBe(0)
  expect(delta.savedPointStoreReads).toBe(0)
  expect(delta.preferenceStoreReads).toBe(0)
  expect(delta.fogWorkerRebuildRequests).toBe(0)
  expect(delta.fogWorkerAppendRequests).toBe(0)
  expect(delta.uniqueDistanceWorkerRequests).toBe(0)
  expect(delta.mapSourceSetDataCalls).toBe(expectedSourceUpdates)
  expect(delta.activityPaintUpdates).toBe(expectedPaintUpdates)
  expect(delta.mapUiNavigations).toBe(expectedNavigations)
  expect(Object.values(delta.idbGetCalls).every((count) => count === 0)).toBe(
    true
  )
  expect(
    Object.values(delta.idbGetAllCalls).every((count) => count === 0)
  ).toBe(true)
  expect(Object.values(delta.idbWriteCalls).every((count) => count === 0)).toBe(
    true
  )
}

async function setShowFog(app: AppPage, showFog: boolean) {
  if (!(await app.drawer.isVisible().catch(() => false))) {
    // A deep-linked activity card can overlap the controls trigger. The test
    // is changing a control state here; the dismissal assertions still use
    // real canvas mouse clicks.
    await app.openDrawerButton.dispatchEvent("click")
    await expect(app.drawer).toBeVisible()
  }
  const toggle = app.drawer.getByRole("switch", { name: "Show fog" })
  const isShown = (await toggle.getAttribute("data-checked")) !== null
  if (isShown !== showFog) await toggle.click()
  await app.closeDrawer()
  await expect(app.page.locator("[data-vaul-overlay]")).toHaveCount(0)
}

async function openMapUrl(app: AppPage, url: string, showFog: boolean) {
  await app.page.goto(url)
  await app.waitUntilReady()
  await setShowFog(app, showFog)
}

async function runDismissalCoverage(app: AppPage, showFog: boolean) {
  await installPerformanceCounters(app.page)
  await app.goto()
  // Seed both stores before the reload that follows the activity import. This
  // keeps the browser test on the real restore path for photos and points.
  await app.seedPhoto({
    id: PHOTO_ID,
    takenAtMs: PHOTO_TAKEN_AT,
    lng: PHOTO_COORDINATE[0],
    lat: PHOTO_COORDINATE[1],
  })
  await app.seedSavedPoint({
    id: SAVED_POINT_ID,
    name: SAVED_POINT_NAME,
    description: null,
    lng: SAVED_POINT_COORDINATE[0],
    lat: SAVED_POINT_COORDINATE[1],
    color: "blue",
    isPublic: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  })
  await app.importActivities(1)
  await app.waitForImportToSettle()
  await app.reload()

  const activity = (await app.localActivities()).find(
    (item) => item.name === "t1.gpx"
  )
  if (!activity) throw new Error("dismissal activity was not imported")
  const activityUrl = `/map?activity=${encodeURIComponent(activity.id)}`

  await openMapUrl(app, "/map", showFog)
  await waitForMapIdle(app.page)
  const emptyClickBefore = await readPerformanceCounters(app.page)
  for (let click = 0; click < 3; click++) await app.clickMapBackground()
  await expect(app.page).toHaveURL(/\/map$/)
  const emptyClickDelta = diffPerformanceCounters(
    emptyClickBefore,
    await readPerformanceCounters(app.page)
  )
  expectNoDismissalWork(emptyClickDelta, 0)

  await openMapUrl(app, activityUrl, showFog)
  await waitForMapIdle(app.page)
  const activityTitle = app.page.getByText(activity.name, { exact: true })
  const deleteActivity = app.page.getByRole("button", {
    name: "Delete activity",
  })
  await expect(activityTitle).toBeVisible()
  await expect(deleteActivity).toBeVisible()
  const activityCloseBefore = await readPerformanceCounters(app.page)
  await app.clickMapBackground()
  await expect(activityTitle).toBeHidden()
  await expect(deleteActivity).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)
  expectNoDismissalWork(
    diffPerformanceCounters(
      activityCloseBefore,
      await readPerformanceCounters(app.page)
    ),
    1,
    0,
    1
  )

  await openMapUrl(app, "/map", showFog)
  await waitForMapIdle(app.page)
  const photoMarker = app.page
    .locator(".maplibregl-marker")
    .filter({ has: app.page.locator("img") })
    .first()
  const photoMarkerImage = photoMarker.locator("img")
  await expect(photoMarkerImage).toBeVisible()
  await photoMarkerImage.click()
  const photoImage = app.page.getByAltText("Photo")
  await expect(photoImage).toBeVisible()
  const photoCloseBefore = await readPerformanceCounters(app.page)
  await app.clickMapBackground()
  await expect(photoImage).toBeHidden()
  expectNoDismissalWork(
    diffPerformanceCounters(
      photoCloseBefore,
      await readPerformanceCounters(app.page)
    ),
    0,
    0,
    1
  )

  await openMapUrl(
    app,
    `/map?savedPoint=${encodeURIComponent(SAVED_POINT_ID)}`,
    showFog
  )
  await waitForMapIdle(app.page)
  const saveChanges = app.page.getByRole("button", { name: "Save changes" })
  await expect(saveChanges).toBeVisible()
  const savedPointCloseBefore = await readPerformanceCounters(app.page)
  await app.clickMapBackground()
  await expect(saveChanges).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)
  expectNoDismissalWork(
    diffPerformanceCounters(
      savedPointCloseBefore,
      await readPerformanceCounters(app.page)
    ),
    1,
    0,
    1
  )

  const publicPointUrl = `/map?savedPoint=${encodeURIComponent(PUBLIC_POINT_ID)}`
  const publicPointRoute = `**/api/public/saved-points/${PUBLIC_POINT_ID}`
  await app.page.route(publicPointRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PUBLIC_POINT),
    })
  )
  await openMapUrl(app, publicPointUrl, showFog)
  await waitForMapIdle(app.page)
  const publicPointTitle = app.page.getByText(PUBLIC_POINT_NAME, {
    exact: true,
  })
  await expect(publicPointTitle).toBeVisible()
  const publicPointCloseBefore = await readPerformanceCounters(app.page)
  await app.clickMapBackground()
  await expect(publicPointTitle).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)
  expectNoDismissalWork(
    diffPerformanceCounters(
      publicPointCloseBefore,
      await readPerformanceCounters(app.page)
    ),
    1,
    1,
    1
  )
  await app.page.unroute(publicPointRoute)

  // Source-backed and DOM-backed interactive targets must not dismiss an open
  // activity card as a side effect of their own selection.
  await openMapUrl(app, activityUrl, showFog)
  await expect(deleteActivity).toBeVisible()
  await photoMarkerImage.click()
  await expect(photoImage).toBeVisible()
  await expect(deleteActivity).toBeVisible()
  const photoCard = photoImage.locator("xpath=ancestor::div[@data-slot='card']")
  await photoCard.getByRole("button", { name: "Close" }).click()
  await expect(photoImage).toBeHidden()

  await app.clickMapCoordinate(SAVED_POINT_COORDINATE)
  await expect(saveChanges).toBeVisible()
  await expect(deleteActivity).toBeVisible()
}

for (const showFog of [true, false]) {
  test(`dismisses map dialogs with Show fog ${showFog ? "on" : "off"}`, async ({
    app,
  }) => {
    await runDismissalCoverage(app, showFog)
  })
}

test("ignores delayed public saved-point responses after dismissal and query changes", async ({
  app,
}) => {
  await installPerformanceCounters(app.page)
  await app.goto()

  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  let firstStarted!: () => void
  let secondStarted!: () => void
  let firstFinished!: () => void
  let secondFinished!: () => void
  const firstRequest = new Promise<void>((resolve) => {
    firstStarted = resolve
  })
  const secondRequest = new Promise<void>((resolve) => {
    secondStarted = resolve
  })
  const firstCompletion = new Promise<void>((resolve) => {
    firstFinished = resolve
  })
  const secondCompletion = new Promise<void>((resolve) => {
    secondFinished = resolve
  })
  let pointARequests = 0

  await app.page.route("**/api/public/saved-points/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)
    if (id === PUBLIC_POINT_ID) {
      pointARequests++
      const gate = pointARequests === 1 ? firstGate : secondGate
      const started = pointARequests === 1 ? firstStarted : secondStarted
      const finished = pointARequests === 1 ? firstFinished : secondFinished
      started()
      await gate
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(PUBLIC_POINT),
        })
      } catch {
        // A fetcher may abort a stale request while the route is still held.
      } finally {
        finished()
      }
      return
    }
    if (id === PUBLIC_POINT_B.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PUBLIC_POINT_B),
      })
      return
    }
    await route.fallback()
  })

  await app.page.goto(`/map?savedPoint=${encodeURIComponent(PUBLIC_POINT_ID)}`)
  await app.waitUntilReady()
  await firstRequest
  const initialHistoryKey = await app.page.evaluate(
    () => (history.state as { key?: unknown } | null)?.key ?? null
  )
  await app.clickMapBackground()
  await expect(app.page).toHaveURL(/\/map$/)
  await expect
    .poll(
      () =>
        app.page.evaluate(
          () => (history.state as { key?: unknown } | null)?.key ?? null
        ),
      { message: "map dismissal navigation did not commit" }
    )
    .not.toBe(initialHistoryKey)
  releaseFirst()
  await firstCompletion
  await expect(
    app.page.getByText(PUBLIC_POINT_NAME, { exact: true })
  ).toHaveCount(0)

  // Re-enter the first query in the same document, then change it to B while
  // A is still pending. This exercises the response-id check rather than only
  // relying on a browser navigation to cancel the request.
  await pushSavedPointQuery(app, PUBLIC_POINT_ID)
  await secondRequest
  await pushSavedPointQuery(app, PUBLIC_POINT_B.id)
  await expect(
    app.page.getByText(PUBLIC_POINT_B.name, { exact: true })
  ).toBeVisible()
  releaseSecond()
  await secondCompletion
  await expect(
    app.page.getByText(PUBLIC_POINT_B.name, { exact: true })
  ).toBeVisible()
  await expect(
    app.page.getByText(PUBLIC_POINT_NAME, { exact: true })
  ).toHaveCount(0)
})
