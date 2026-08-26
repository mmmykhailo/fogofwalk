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
    await expect(app.page).toHaveURL(/\/$/)
    await expect(app.page.getByTestId("cached-map-canvas")).toBeVisible()
  })
})
