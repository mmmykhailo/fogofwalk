import { test, expect } from "../fixtures/app"
import { API_URL } from "../fixtures/ports"

/**
 * The load-bearing guarantee of the whole design: built without `VITE_API_URL`,
 * the app is exactly what it was before the server existed. This project points
 * at a dev server started with that variable empty.
 */
test.describe("server-less build", () => {
  test("shows no account UI and never calls the API", async ({ app }) => {
    const apiCalls: string[] = []
    app.page.on("request", (request) => {
      if (request.url().startsWith(API_URL)) apiCalls.push(request.url())
    })

    await app.goto()
    await app.openDrawer()

    // No account row in either state, and no sign-in entry.
    await expect(app.accountRow).toBeHidden()
    await expect(app.signInRow).toBeHidden()

    // The pre-server drawer is intact.
    await expect(
      app.drawer.getByRole("button", { name: "Add files" })
    ).toBeVisible()
    await expect(
      app.drawer.getByRole("switch", { name: "Show fog" })
    ).toBeVisible()
    await expect(
      app.drawer.getByRole("link", { name: "Statistics" })
    ).toBeVisible()
    await expect(app.drawer.getByRole("link", { name: "Help" })).toBeVisible()

    expect(apiCalls).toEqual([])
  })

  test("importing works offline with no sync attempted", async ({ app }) => {
    const apiCalls: string[] = []
    app.page.on("request", (request) => {
      if (request.url().startsWith(API_URL)) apiCalls.push(request.url())
    })

    await app.goto()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.expectActivityCount(2)

    await app.reload()
    await app.expectActivityCount(2)

    expect(apiCalls).toEqual([])
  })

  test("metadata edits stay local with no server configured", async ({
    app,
  }) => {
    const apiCalls: string[] = []
    app.page.on("request", (request) => {
      if (request.url().startsWith(API_URL)) apiCalls.push(request.url())
    })

    await app.goto()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    const activity = (await app.localActivities())[0]!
    await app.page.goto("/activities")
    await expect(
      app.page.getByRole("heading", { name: "My activities" })
    ).toBeVisible()

    const typeSelect = app.page.getByRole("combobox", {
      name: `Activity type for ${activity.name}`,
    })
    await typeSelect.click()
    await app.page.getByRole("option", { name: "Cycling", exact: true }).click()
    await expect(typeSelect).toContainText("Cycling")
    expect(apiCalls).toEqual([])
  })

  test("keeps restored clearings when another activity is imported", async ({
    app,
  }) => {
    await app.goto()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await expect
      .poll(() => app.fogCacheSummary())
      .toMatchObject({
        activityIds: [expect.any(String)],
        fogMode: "corridor",
        ringCount: 2,
      })

    // The map can render this cache immediately, but a new worker starts with
    // no internal geometry after reload. The next addition must replay the old
    // activity as well as process the new one.
    await app.reload()
    await app.importActivities(1, 10)
    await app.waitForImportToSettle()

    await expect
      .poll(async () => (await app.fogCacheSummary())?.activityIds)
      .toHaveLength(2)
    await expect
      .poll(async () => (await app.fogCacheSummary())?.ringCount)
      .toBe(3)
  })

  test("keeps the final fog update during a map-style change", async ({
    app,
  }) => {
    await app.goto()
    await app.importActivities(2)
    await app.waitForImportToSettle()

    // Move to the inline terrain style first. Switching back requests the
    // standard style, which the test holds so the fog worker is guaranteed to
    // finish while MapLibre has temporarily destroyed the custom sources.
    await app.openDrawer()
    await app.drawer.getByTitle("Terrain").click()
    await app.page.waitForTimeout(250)

    let releaseStyle!: () => void
    const styleGate = new Promise<void>((resolve) => {
      releaseStyle = resolve
    })
    let sawStyleRequest!: () => void
    const styleRequested = new Promise<void>((resolve) => {
      sawStyleRequest = resolve
    })
    await app.page.route(
      "https://tiles.openfreemap.org/styles/liberty",
      async (route) => {
        sawStyleRequest()
        await styleGate
        await route.fallback()
      }
    )

    await app.drawer.getByTitle("Standard").click()
    await styleRequested
    await app.drawer.getByRole("switch", { name: "Fill loops" }).click()
    await app.waitForImportToSettle()
    releaseStyle()

    await expect
      .poll(() => app.fogCacheSummary())
      .toMatchObject({
        fogMode: "fill",
        ringCount: 3,
      })
  })

  test("clear all simply clears, with no server caveat", async ({ app }) => {
    await app.goto()
    await app.importActivities(2)
    await app.waitForImportToSettle()

    await app.openDrawer()
    await app.drawer.getByRole("button", { name: "Clear all" }).click()
    const dialog = app.page.getByRole("dialog", { name: /Clear all data/ })
    await expect(dialog).toBeVisible()
    // The sync explanation belongs only to signed-in users.
    await expect(dialog).not.toContainText("server")
    await dialog.getByRole("button", { name: "Clear all" }).click()
    await expect(dialog).toBeHidden()

    await app.expectActivityCount(0)
  })

  test("keeps the live map mounted while visiting statistics", async ({
    app,
  }) => {
    await app.goto()
    const mapCanvas = app.page.locator(".maplibregl-canvas").first()
    await expect(mapCanvas).toBeVisible()
    await mapCanvas.evaluate((canvas) =>
      canvas.setAttribute("data-testid", "cached-map-canvas")
    )

    await app.openDrawer()
    await app.drawer.getByRole("link", { name: "Statistics" }).click()
    await expect(
      app.page.locator("[data-page-transition-overlay]")
    ).toHaveClass(/opacity-100/)
    await expect(app.page).toHaveURL(/\/stats$/)
    await expect(app.page.getByTestId("cached-map-canvas")).toHaveCount(1)
    await expect(app.page.locator("[data-map-cache]")).toHaveAttribute(
      "inert",
      ""
    )

    await app.page.getByRole("link", { name: "Back to map" }).click()
    await expect(app.page).toHaveURL(/\/map$/)
    await expect(app.page.getByTestId("cached-map-canvas")).toBeVisible()
  })
})
