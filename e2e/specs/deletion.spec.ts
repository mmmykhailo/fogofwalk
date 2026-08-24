import { test, expect } from "../fixtures/app"
import { makeGpxSet } from "../fixtures/gpx"

/**
 * The three deletion semantics are deliberately different, and confusing them
 * has already destroyed a user's server library once. Each is pinned here.
 *
 *   delete activity, switch on   → server row gone, tombstone, other devices drop it
 *   delete activity, switch off  → server row kept, no tombstone, this device forgets it
 *   clear all                 → server untouched entirely
 *   remove all (account)      → every server row gone, no tombstone, devices keep theirs
 */
test.describe("deletion semantics", () => {
  test("deleting with the server switch on removes it everywhere", async ({
    app,
    secondDevice,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    // B syncs first, so its cursor is non-zero and tombstones actually apply.
    const deviceB = await secondDevice()
    await deviceB.goto()
    await deviceB.signIn()
    await deviceB.syncNow()
    await deviceB.expectActivityCount(2)

    await app.deleteActivity("t1.gpx", true)
    await app.expectActivityCount(1)

    const state = await serverState(app.page)
    expect(state.activities).toHaveLength(1)
    expect(state.tombstones).toHaveLength(1)

    await deviceB.syncNow()
    await deviceB.expectActivityCount(1)
  })

  test("deleting with the switch off keeps the server copy and does not re-download", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteActivity("t1.gpx", false)
    await app.expectActivityCount(1)

    // Still on the server, and no tombstone was written.
    const state = await serverState(app.page)
    expect(state.activities).toHaveLength(2)
    expect(state.tombstones).toHaveLength(0)

    // A local-only delete suspends sync; resuming must not resurrect it.
    await app.syncNow()
    await app.expectActivityCount(1)
    await app.reload()
    await app.expectActivityCount(1)
  })

  /** The bug the user hit: clear-all used to tombstone every activity. */
  test("clear all leaves the server untouched and the activities come back", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    const before = await serverState(app.page)
    expect(before.activities).toHaveLength(2)

    await app.clearAll()
    await app.expectActivityCount(0)

    // The server still has everything, and nothing was tombstoned.
    const after = await serverState(app.page)
    expect(after.activities).toHaveLength(2)
    expect(after.tombstones).toHaveLength(0)

    // A reload lifts the suspension and the library is restored.
    await app.reload()
    await app.expectActivityCount(2)
  })

  /**
   * A tombstone must apply once. The manifest cursor is an inclusive lower
   * bound, so a fresh tombstone is served again on the next sync; applying it
   * twice deleted a file the user had deliberately re-imported and refused to
   * upload it.
   */
  test("a deleted activity can be re-imported and comes back on the server", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.deleteActivity("t1.gpx", true)
    await app.expectActivityCount(1)
    expect((await serverState(app.page)).tombstones).toHaveLength(1)

    // The same file again, moments later, while its tombstone is still current.
    await app.importFiles(makeGpxSet(1))
    await app.waitForImportToSettle()
    await app.expectActivityCount(2)

    await app.syncNow()
    await app.expectActivityCount(2)

    const state = await serverState(app.page)
    expect(state.activities).toHaveLength(2)
    expect(state.tombstones).toHaveLength(0)
  })

  /**
   * `clear-all` drops syncState, so the next sync walks from scratch and the
   * manifest replays every tombstone the account ever wrote. Honouring them
   * there deletes activities the user re-imported in the meantime — a from-scratch
   * walk must converge on the union of local and server, never on deletion.
   */
  test("an activity re-imported after a clear-all survives its old tombstone", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    // t1 gets a tombstone…
    await app.deleteActivity("t1.gpx", true)
    await app.expectActivityCount(1)
    expect((await serverState(app.page)).tombstones).toHaveLength(1)

    // …then everything local goes, taking the sync state with it.
    await app.clearAll()
    await app.expectActivityCount(0)

    // Re-imported while sync is still suspended, so the next walk starts from
    // scratch with t1 present locally *and* its tombstone in the window.
    await app.importFiles(makeGpxSet(1))
    await app.waitForImportToSettle()
    await app.expectActivityCount(1)

    await app.reload()

    // t1 survives and t2 comes back down.
    await app.expectActivityCount(2)
    await app.syncNow()
    expect((await serverState(app.page)).activities).toHaveLength(2)
  })

  test("remove all wipes the server but leaves every device intact", async ({
    app,
    secondDevice,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    const deviceB = await secondDevice()
    await deviceB.goto()
    await deviceB.signIn()
    await deviceB.syncNow()
    await deviceB.expectActivityCount(2)

    await app.removeAllFromServer()

    // Server empty, and crucially *no tombstones* — that is what makes this
    // "server only" rather than "delete everywhere".
    const state = await serverState(app.page)
    expect(state.activities).toHaveLength(0)
    expect(state.tombstones).toHaveLength(0)

    // Both devices keep their activities…
    await app.expectActivityCount(2)
    await deviceB.expectActivityCount(2)

    // …and nothing gets helpfully re-uploaded on the next sync.
    await app.syncNow()
    expect((await serverState(app.page)).activities).toHaveLength(0)
  })
})
