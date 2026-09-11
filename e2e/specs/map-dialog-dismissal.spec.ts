import { test, expect } from "../fixtures/app"
import type { AppPage } from "../fixtures/app-page"

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

  await openMapUrl(app, activityUrl, showFog)
  const activityTitle = app.page.getByText(activity.name, { exact: true })
  const deleteActivity = app.page.getByRole("button", {
    name: "Delete activity",
  })
  await expect(activityTitle).toBeVisible()
  await expect(deleteActivity).toBeVisible()
  await app.clickMapBackground()
  await expect(activityTitle).toBeHidden()
  await expect(deleteActivity).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)

  await openMapUrl(app, "/map", showFog)
  const photoMarker = app.page
    .locator(".maplibregl-marker")
    .filter({ has: app.page.locator("img") })
    .first()
  const photoMarkerImage = photoMarker.locator("img")
  await expect(photoMarkerImage).toBeVisible()
  await photoMarkerImage.click()
  const photoImage = app.page.getByAltText("Photo")
  await expect(photoImage).toBeVisible()
  await app.clickMapBackground()
  await expect(photoImage).toBeHidden()

  await openMapUrl(
    app,
    `/map?savedPoint=${encodeURIComponent(SAVED_POINT_ID)}`,
    showFog
  )
  const saveChanges = app.page.getByRole("button", { name: "Save changes" })
  await expect(saveChanges).toBeVisible()
  await app.clickMapBackground()
  await expect(saveChanges).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)

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
  const publicPointTitle = app.page.getByText(PUBLIC_POINT_NAME, {
    exact: true,
  })
  await expect(publicPointTitle).toBeVisible()
  await app.clickMapBackground()
  await expect(publicPointTitle).toBeHidden()
  await expect(app.page).toHaveURL(/\/map$/)
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
