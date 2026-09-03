import { test, expect } from "../fixtures/app"

/**
 * A local-only deletion pauses automatic sync until the page reloads.
 *
 * Without it the very next sync — which `clear-all` triggers from scratch —
 * downloads everything straight back and the delete undoes itself in seconds.
 */
test.describe("sync suspension", () => {
  test("clear all pauses sync and says so", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.clearAll()

    expect(await app.accountRowDescription()).toContain("Sync paused")
  })

  test("automatic triggers do not restore while paused", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()

    await app.closeDrawer()
    await app.fireAutomaticSyncTriggers()
    await app.fireAutomaticSyncTriggers()

    await app.expectActivityCount(0)
  })

  test("the explicit resume brings the activities back", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()
    await app.expectActivityCount(0)

    // The button reads "Resume sync" while suspended.
    const dialog = await app.openAccountDialog()
    await expect(dialog.getByTestId("sync-now")).toContainText("Resume sync")
    await app.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    await app.syncNow()
    await app.expectActivityCount(2)
  })

  test("preserves Fill loops while importing and resuming sync after a clear", async ({
    app,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.openDrawer()
    await app.drawer.getByRole("switch", { name: "Fill loops" }).click()
    await app.waitForImportToSettle()
    await app.clearAll()

    await app.importActivities(1, 10)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.expectActivityCount(2)

    await expect
      .poll(() => app.fogCacheSummary())
      .toMatchObject({ fogMode: "fill" })
  })

  test("a reload lifts the suspension", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()
    await app.expectActivityCount(0)

    await app.reload()

    await app.expectActivityCount(2)
    expect(await app.accountRowDescription()).not.toContain("Sync paused")
  })

  test("a local-only activity delete suspends too", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteActivity("t1.gpx", false)

    expect(await app.accountRowDescription()).toContain("Sync paused")
  })

  test("deleting on the server too does not suspend", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteActivity("t1.gpx", true)

    // Nothing can come back, so there is nothing to pause.
    expect(await app.accountRowDescription()).not.toContain("Sync paused")
  })
})
