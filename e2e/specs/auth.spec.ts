import { test, expect } from "../fixtures/app"
import { UNLISTED_LOGIN } from "../fixtures/ports"

test.describe("auth and account lifecycle", () => {
  test("signs in through the real OAuth flow", async ({ app }) => {
    await app.goto()
    await app.openDrawer()
    await expect(app.signInRow).toBeVisible()

    await app.signIn()

    await expect(app.accountRow).toContainText(`E2E ${app.login}`)
  })

  test("keeps the session across a reload", async ({ app }) => {
    await app.goto()
    await app.signIn()

    await app.reload()

    await app.openDrawer()
    await expect(app.accountRow).toContainText(`E2E ${app.login}`)
  })

  test("logs out and returns to the signed-out row", async ({ app }) => {
    await app.goto()
    await app.signIn()

    await app.logOut()

    await app.openDrawer()
    await expect(app.signInRow).toBeVisible()
    await expect(app.accountRow).toBeHidden()
  })

  test("a login without approval is signed in but gated", async ({
    browser,
    secondDevice,
  }) => {
    const app = await secondDevice(UNLISTED_LOGIN)
    await app.goto()
    await app.signIn()

    // Signed in — the name shows.
    await expect(app.accountRow).toContainText(`E2E ${UNLISTED_LOGIN}`)
    // But sync is gated.
    await expect(app.accountRow).toContainText("Not enabled for sync")

    const dialog = await app.openAccountDialog()
    await expect(dialog.getByText(/isn.t enabled for sync yet/)).toBeVisible()
    await expect(dialog.getByTestId("sync-now")).toBeHidden()
  })

  test("delete account erases the server data but keeps local tracks", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    expect((await serverState(app.page)).tracks).toHaveLength(2)

    await app.deleteAccount()

    // Signed out…
    await app.openDrawer()
    await expect(app.signInRow).toBeVisible()
    // …but the device keeps its tracks, including across a reload.
    await app.expectTrackCount(2)
    await app.reload()
    await app.expectTrackCount(2)
  })
})
