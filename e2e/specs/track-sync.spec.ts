import { test, expect } from "../fixtures/app"
import { makeGpxSet } from "../fixtures/gpx"

test.describe("track sync", () => {
  test("imported tracks are uploaded to the server", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(3)
    await app.waitForImportToSettle()
    await app.expectTrackCount(3)

    await app.syncNow()

    const state = await serverState(app.page)
    expect(state.tracks.map((t) => t.name).sort()).toEqual([
      "t1.gpx",
      "t2.gpx",
      "t3.gpx",
    ])
    expect(state.tombstones).toHaveLength(0)
  })

  test("a second device downloads what the first uploaded", async ({
    app,
    secondDevice,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    const deviceB = await secondDevice()
    await deviceB.goto()
    await deviceB.signIn()

    // Signing in triggers a sync on its own; give it the chance before nudging.
    await deviceB.syncNow()
    await deviceB.expectTrackCount(2)
  })

  test("a track added on the second device reaches the first", async ({
    app,
    secondDevice,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    const deviceB = await secondDevice()
    await deviceB.goto()
    await deviceB.signIn()
    await deviceB.syncNow()
    await deviceB.expectTrackCount(1)

    // B imports something new…
    await deviceB.importFiles(makeGpxSet(1, 50))
    await deviceB.waitForImportToSettle()
    await deviceB.syncNow()

    // …and A picks it up.
    await app.syncNow()
    await app.expectTrackCount(2)
  })

  /**
   * The regression that shipped: re-importing files that are already present
   * deduped them all, posted nothing to the fog worker, and left the progress
   * indicator waiting on a DONE that could never arrive.
   */
  test("re-importing the same files adds nothing and does not hang", async ({
    app,
  }) => {
    const files = makeGpxSet(3)

    await app.goto()
    await app.signIn()
    await app.importFiles(files)
    await app.waitForImportToSettle()
    await app.expectTrackCount(3)

    await app.importFiles(files)

    const dialog = app.page.getByRole("dialog", {
      name: /Tracks already added/,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("All 3 tracks are already on your map")
    await app.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    // Still three, and crucially not stuck on "Processing".
    await app.expectTrackCount(3)
    await expect(app.page.getByTestId("drawer-status")).not.toContainText(
      "Processing"
    )
  })

  test("a partial re-import adds only the new tracks", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importFiles(makeGpxSet(2))
    await app.waitForImportToSettle()
    await app.expectTrackCount(2)

    // t1 and t2 again, plus two it has never seen.
    await app.importFiles([...makeGpxSet(2), ...makeGpxSet(2, 10)])
    await app.waitForImportToSettle()

    await app.expectTrackCount(4)
  })

  test("tracks survive a reload without re-uploading", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.reload()
    await app.expectTrackCount(2)
    await app.syncNow()

    // Two tracks, not four — the content hash is the identity, not the row.
    expect((await serverState(app.page)).tracks).toHaveLength(2)
  })
})
