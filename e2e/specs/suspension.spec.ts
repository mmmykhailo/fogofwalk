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
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.clearAll()

    expect(await app.accountRowDescription()).toContain("Sync paused")
  })

  test("automatic triggers do not restore while paused", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()

    await app.closeDrawer()
    await app.fireAutomaticSyncTriggers()
    await app.fireAutomaticSyncTriggers()

    await app.expectTrackCount(0)
  })

  test("the explicit resume brings the tracks back", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()
    await app.expectTrackCount(0)

    // The button reads "Resume sync" while suspended.
    const dialog = await app.openAccountDialog()
    await expect(dialog.getByTestId("sync-now")).toContainText("Resume sync")
    await app.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    await app.syncNow()
    await app.expectTrackCount(2)
  })

  test("a reload lifts the suspension", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()
    await app.clearAll()
    await app.expectTrackCount(0)

    await app.reload()

    await app.expectTrackCount(2)
    expect(await app.accountRowDescription()).not.toContain("Sync paused")
  })

  test("a local-only track delete suspends too", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteTrack("t1.gpx", false)

    expect(await app.accountRowDescription()).toContain("Sync paused")
  })

  test("deleting on the server too does not suspend", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteTrack("t1.gpx", true)

    // Nothing can come back, so there is nothing to pause.
    expect(await app.accountRowDescription()).not.toContain("Sync paused")
  })
})
