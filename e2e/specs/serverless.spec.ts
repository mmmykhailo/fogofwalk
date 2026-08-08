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
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.expectTrackCount(2)

    await app.reload()
    await app.expectTrackCount(2)

    expect(apiCalls).toEqual([])
  })

  test("clear all simply clears, with no server caveat", async ({ app }) => {
    await app.goto()
    await app.importTracks(2)
    await app.waitForImportToSettle()

    await app.openDrawer()
    await app.drawer.getByRole("button", { name: "Clear all" }).click()
    const dialog = app.page.getByRole("dialog", { name: /Clear all data/ })
    await expect(dialog).toBeVisible()
    // The sync explanation belongs only to signed-in users.
    await expect(dialog).not.toContainText("server")
    await dialog.getByRole("button", { name: "Clear all" }).click()
    await expect(dialog).toBeHidden()

    await app.expectTrackCount(0)
  })
})
