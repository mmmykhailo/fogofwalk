import { expect, test } from "../fixtures/app"

test.describe("sync cancellation", () => {
  test("signing out during a run aborts before uploading local effects", async ({
    app,
  }) => {
    await app.goto()

    // Import while signed out so the activity's upload effect is waiting in the
    // local outbox when the authenticated run starts.
    await app.importActivities(1)
    await app.waitForImportToSettle()

    let savedPointManifestStarted = false
    let releaseSavedPointManifest!: () => void
    const savedPointManifestGate = new Promise<void>((resolve) => {
      releaseSavedPointManifest = resolve
    })
    let uploadRequests = 0

    const onRequest = (request: { method(): string; url(): string }) => {
      if (
        request.method() === "PUT" &&
        request.url().includes("/api/activities/")
      ) {
        uploadRequests += 1
      }
    }

    await app.page.route(
      "**/api/saved-points/manifest**",
      async (route) => {
        savedPointManifestStarted = true
        await savedPointManifestGate
        await route.abort().catch(() => {})
      }
    )
    app.page.on("request", onRequest)

    try {
      await app.signIn()
      await expect
        .poll(() => savedPointManifestStarted, { timeout: 30_000 })
        .toBe(true)

      await app.logOut()
      releaseSavedPointManifest()

      await expect.poll(() => uploadRequests, { timeout: 5_000 }).toBe(0)
      await app.openDrawer()
      await expect(app.signInRow).toBeVisible()
      await expect(app.accountRow).toBeHidden()
      expect(await app.localActivities()).toHaveLength(1)
    } finally {
      releaseSavedPointManifest()
      app.page.off("request", onRequest)
      await app.page.unroute("**/api/saved-points/manifest**")
    }
  })

  test("switching accounts during a run does not apply A's outbox to B", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.importActivities(1)
    await app.waitForImportToSettle()

    let savedPointManifestStarted = false
    let releaseSavedPointManifest!: () => void
    const savedPointManifestGate = new Promise<void>((resolve) => {
      releaseSavedPointManifest = resolve
    })
    const activityUploads: string[] = []

    await app.page.route("**/api/saved-points/manifest**", async (route) => {
      savedPointManifestStarted = true
      await savedPointManifestGate
      await route.continue().catch(() => {})
    })
    const onRequest = (request: { method(): string; url(): string }) => {
      if (
        request.method() === "PUT" &&
        request.url().includes("/api/activities/")
      ) {
        activityUploads.push(request.url())
      }
    }
    app.page.on("request", onRequest)

    try {
      await app.signIn()
      await expect
        .poll(() => savedPointManifestStarted, { timeout: 30_000 })
        .toBe(true)
      expect(activityUploads).toHaveLength(0)
      expect((await serverState(app.page)).activities).toHaveLength(0)

      await app.logOut()
      releaseSavedPointManifest()
      await expect
        .poll(() => activityUploads, { timeout: 5_000 })
        .toHaveLength(0)

      await app.signInAs(`${app.login}-b`)
      await app.syncNow()

      expect(activityUploads).toHaveLength(0)
      expect((await serverState(app.page)).activities).toHaveLength(0)
      expect(await app.localActivities()).toHaveLength(1)
    } finally {
      releaseSavedPointManifest()
      app.page.off("request", onRequest)
      await app.page.unroute("**/api/saved-points/manifest**")
    }
  })
})
