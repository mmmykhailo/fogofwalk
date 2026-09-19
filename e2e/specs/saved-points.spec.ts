import type { Page } from "@playwright/test"
import { test, expect, readSessionToken } from "../fixtures/app"
import { API_URL } from "../fixtures/ports"
import { makeGpx } from "../fixtures/gpx"
import { waitForMapIdle } from "../fixtures/performance"
import type { AppPage } from "../fixtures/app-page"

const POINT_ID = "b6069503-50e1-48d2-a4d1-4a5f8a7d70db"
const POINT_NAME = "E2E lookout"
const NOW = 1_700_000_000_000
const OVERLAP_NEWER_ID = "00000000-0000-4000-8000-000000000001"
const OVERLAP_OLDER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const OVERLAP_NEWER_NAME = "Newer overlap point"
const OVERLAP_OLDER_NAME = "Older overlap point"
const OVERLAP_NEWER_COORDINATE: [number, number] = [14.42, 50.08804]
const OVERLAP_OLDER_COORDINATE: [number, number] = [14.42015, 50.08804]
const OVERLAP_NEWER_RGB: [number, number, number] = [124, 58, 237]
const TRACK_COORDINATE: [number, number] = [13.452, 52.5516]

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

async function prepareOverlapMap(app: AppPage): Promise<void> {
  await app.page.evaluate(() => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    map.jumpTo({
      center: [14.420075, 50.08804],
      zoom: 15,
    })
  })
  await waitForMapIdle(app.page)

  const separation = await app.page.evaluate(
    ({ newer, older }) => {
      const map = window.__fogofwalkE2eMap
      if (!map) throw new Error("MapLibre test handle is unavailable")
      const newerPoint = map.project(newer)
      const olderPoint = map.project(older)
      return Math.hypot(
        newerPoint.x - olderPoint.x,
        newerPoint.y - olderPoint.y
      )
    },
    {
      newer: OVERLAP_NEWER_COORDINATE,
      older: OVERLAP_OLDER_COORDINATE,
    }
  )
  if (separation < 6 || separation > 8) {
    throw new Error(
      `Saved-point overlap geometry is ${separation.toFixed(2)} CSS pixels; expected 6–8.`
    )
  }

  await app.page.waitForFunction((coordinate) => {
    const map = window.__fogofwalkE2eMap
    if (!map) return false
    const point = map.project(coordinate)
    return (
      map.queryRenderedFeatures([point.x, point.y], {
        layers: ["saved-points-hit-layer"],
      }).length >= 2
    )
  }, OVERLAP_OLDER_COORDINATE)
}

async function assertNewestOverlapWins(app: AppPage): Promise<void> {
  await prepareOverlapMap(app)

  const pixel = await readPixel(app.page, OVERLAP_OLDER_COORDINATE)
  for (const [index, expected] of OVERLAP_NEWER_RGB.entries()) {
    expect(Math.abs(pixel[index]! - expected)).toBeLessThan(35)
  }
  expect(pixel[3]).toBeGreaterThan(200)

  await app.clickMapCoordinate(OVERLAP_OLDER_COORDINATE)
  const nameInput = app.page.getByRole("textbox", { name: "Name" })
  await expect(nameInput).toHaveValue(OVERLAP_NEWER_NAME)
  await app.page.getByRole("button", { name: "Close" }).click()
  await expect(nameInput).toBeHidden()
}

interface ProjectedTrackCoordinate {
  clientX: number
  clientY: number
  lng: number
  lat: number
}

async function projectTrackCoordinate(
  app: AppPage
): Promise<ProjectedTrackCoordinate> {
  await app.page.evaluate((coordinate) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    map.jumpTo({ center: coordinate, zoom: 15 })
  }, TRACK_COORDINATE)
  await waitForMapIdle(app.page)

  await app.page.waitForFunction((coordinate) => {
    const map = window.__fogofwalkE2eMap
    if (!map?.getLayer("activities-hit-layer")) return false
    const point = map.project(coordinate)
    return (
      map.queryRenderedFeatures([point.x, point.y], {
        layers: ["activities-hit-layer"],
      }).length > 0
    )
  }, TRACK_COORDINATE)

  return app.page.evaluate((coordinate) => {
    const map = window.__fogofwalkE2eMap
    if (!map) throw new Error("MapLibre test handle is unavailable")
    const point = map.project(coordinate)
    const hitFeatures = map.queryRenderedFeatures([point.x, point.y], {
      layers: ["activities-hit-layer"],
    })
    if (hitFeatures.length === 0) {
      throw new Error(
        "The known route coordinate is not on activities-hit-layer"
      )
    }
    const canvasBounds = map.getCanvas().getBoundingClientRect()
    const projectedCoordinate = map.unproject(point)
    return {
      clientX: canvasBounds.left + point.x,
      clientY: canvasBounds.top + point.y,
      lng: projectedCoordinate.lng,
      lat: projectedCoordinate.lat,
    }
  }, TRACK_COORDINATE)
}

async function expectSavedPointEditor(
  app: AppPage,
  coordinate: Pick<ProjectedTrackCoordinate, "lng" | "lat">
): Promise<void> {
  const title = app.page
    .locator('[data-slot="card-title"], [data-slot="dialog-title"]')
    .filter({ hasText: "Save point" })
  await expect(title).toBeVisible()
  await expect(app.page.getByLabel("Longitude")).toHaveValue(
    coordinate.lng.toFixed(6)
  )
  await expect(app.page.getByLabel("Latitude")).toHaveValue(
    coordinate.lat.toFixed(6)
  )
}

async function closeSavedPointEditor(app: AppPage): Promise<void> {
  await app.page.getByRole("button", { name: "Cancel", exact: true }).click()
  const title = app.page
    .locator('[data-slot="card-title"], [data-slot="dialog-title"]')
    .filter({ hasText: "Save point" })
  await expect(title).toBeHidden()
}

async function rightClickMapCoordinate(
  app: AppPage,
  coordinate: ProjectedTrackCoordinate
): Promise<void> {
  await app.page.mouse.click(coordinate.clientX, coordinate.clientY, {
    button: "right",
  })
}

async function dispatchTouchLongPress(
  app: AppPage,
  coordinate: ProjectedTrackCoordinate
): Promise<void> {
  await app.page.evaluate(({ clientX, clientY }) => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")
    if (!canvas) throw new Error("Map canvas is unavailable")
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        clientX,
        clientY,
        buttons: 1,
      })
    )
  }, coordinate)
  await app.page.waitForTimeout(600)
  await app.page.evaluate(({ clientX, clientY }) => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")
    if (!canvas) throw new Error("Map canvas is unavailable")
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        clientX,
        clientY,
        buttons: 0,
      })
    )
  }, coordinate)
}

test.describe("saved points", () => {
  test("edits colour and visibility with dropdown controls", async ({
    app,
  }) => {
    await app.goto()
    await app.seedSavedPoint({
      id: POINT_ID,
      name: POINT_NAME,
      description: null,
      lng: 14.42076,
      lat: 50.08804,
      color: "blue",
      isPublic: false,
      createdAt: NOW,
      updatedAt: NOW,
    })

    await app.page.goto(`/map?savedPoint=${POINT_ID}`)
    await app.page.getByRole("button", { name: "Skip for now" }).click()

    const saveChanges = app.page.getByRole("button", {
      name: "Save changes",
    })
    await expect(saveChanges).toBeVisible()

    await app.page.getByRole("combobox", { name: "Saved point colour" }).click()
    await app.page.getByRole("option", { name: "Purple" }).click()

    await app.page
      .getByRole("combobox", { name: "Saved point visibility" })
      .click()
    await app.page.getByRole("option", { name: "Public" }).click()

    await saveChanges.click()
    await expect(saveChanges).toBeHidden()

    await expect
      .poll(async () => {
        const point = (await app.localSavedPoints()).find(
          ({ id }) => id === POINT_ID
        )
        return point && { color: point.color, isPublic: point.isPublic }
      })
      .toEqual({ color: "purple", isPublic: true })
  })

  test("the owner's public saved-point card is entirely an edit link", async ({
    app,
    login,
    request,
  }) => {
    await app.goto()
    await app.signIn()
    const token = await readSessionToken(app.page)
    const response = await request.put(
      `${API_URL}/api/saved-points/${POINT_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          id: POINT_ID,
          name: POINT_NAME,
          description: "A point published by the browser test.",
          lng: 14.42076,
          lat: 50.08804,
          color: "purple",
          isPublic: true,
        },
      }
    )
    expect(response.ok()).toBeTruthy()

    await app.page.goto(`/u/${login}`)
    const link = app.page
      .getByRole("heading", { name: POINT_NAME })
      .locator("xpath=ancestor::a")
    await expect(link).toBeVisible()

    const card = link.locator("..")
    expect(await card.evaluate((element) => element.tagName)).toBe("DIV")
    await expect(link).toHaveAttribute("href", `/map?savedPoint=${POINT_ID}`)

    const [linkBox, cardBox] = await Promise.all([
      link.boundingBox(),
      card.boundingBox(),
    ])
    expect(linkBox).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(linkBox).toEqual(cardBox)
  })

  test("renders and selects the newest-created point at an overlap", async ({
    app,
  }) => {
    await app.goto()
    await app.seedSavedPoint({
      id: OVERLAP_NEWER_ID,
      name: OVERLAP_NEWER_NAME,
      description: null,
      lng: OVERLAP_NEWER_COORDINATE[0],
      lat: OVERLAP_NEWER_COORDINATE[1],
      color: "purple",
      isPublic: false,
      createdAt: NOW + 200,
      updatedAt: NOW + 200,
    })
    await app.seedSavedPoint({
      id: OVERLAP_OLDER_ID,
      name: OVERLAP_OLDER_NAME,
      description: null,
      lng: OVERLAP_OLDER_COORDINATE[0],
      lat: OVERLAP_OLDER_COORDINATE[1],
      color: "blue",
      isPublic: false,
      createdAt: NOW + 100,
      updatedAt: NOW + 100,
    })

    await app.reload()
    await assertNewestOverlapWins(app)

    await app.seedSavedPoint({
      id: OVERLAP_OLDER_ID,
      name: OVERLAP_OLDER_NAME,
      description: null,
      lng: OVERLAP_OLDER_COORDINATE[0],
      lat: OVERLAP_OLDER_COORDINATE[1],
      color: "blue",
      isPublic: false,
      createdAt: NOW + 100,
      updatedAt: NOW + 10_000,
    })
    await app.reload()
    await assertNewestOverlapWins(app)
  })

  test("creates a saved point over an activity hitbox on desktop and touch", async ({
    app,
  }) => {
    await app.goto()
    await app.importFiles([makeGpx("saved-point-track.gpx", 1, 8)])
    await app.waitForImportToSettle()
    await app.closeDrawer()

    const desktopCoordinate = await projectTrackCoordinate(app)
    await rightClickMapCoordinate(app, desktopCoordinate)
    await expectSavedPointEditor(app, desktopCoordinate)
    await closeSavedPointEditor(app)

    await app.page.setViewportSize({ width: 390, height: 844 })
    await app.page.waitForFunction(
      () => window.matchMedia("(max-width: 639px)").matches
    )
    await waitForMapIdle(app.page)

    const mobileCoordinate = await projectTrackCoordinate(app)
    await dispatchTouchLongPress(app, mobileCoordinate)
    await expectSavedPointEditor(app, mobileCoordinate)
  })
})
