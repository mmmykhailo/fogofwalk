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

    await app.page.route("**/api/saved-points/manifest**", async (route) => {
      savedPointManifestStarted = true
      await savedPointManifestGate
      await route.abort().catch(() => {})
    })
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

  test("keeps saved-point cursors and ownership isolated across accounts", async ({
    app,
  }) => {
    await app.goto()
    await app.signIn()
    // Finish the initial empty run before installing the deterministic A state.
    await app.syncNow()
    const accountA = await app.sessionUserId()
    const pointId = "6c7f2b42-0b65-4f67-9d51-1df6f18a34f4"

    await app.seedSavedPoint({
      id: pointId,
      name: "A's private lookout",
      description: null,
      lng: 14.42076,
      lat: 50.08804,
      color: "blue",
      isPublic: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    await app.seedSavedPointSyncState(accountA, {
      cursor: 123,
      lastSyncAt: 99,
      serverPointIds: [pointId],
      ownedIds: [pointId],
      appliedTombstones: {},
      outboundIds: [pointId],
      outboundDeletionIds: [],
    })
    await app.logOut()

    const manifestSince: string[] = []
    let pointUploads = 0
    await app.page.route("**/api/saved-points/manifest**", async (route) => {
      manifestSince.push(
        new URL(route.request().url()).searchParams.get("since") ?? ""
      )
      await route.continue()
    })
    const onRequest = (request: { method(): string; url(): string }) => {
      if (
        request.method() === "PUT" &&
        request.url().includes(`/api/saved-points/${pointId}`)
      ) {
        pointUploads += 1
      }
    }
    app.page.on("request", onRequest)

    try {
      await app.signInAs(`${app.login}-b`)
      const accountB = await app.sessionUserId()
      await app.syncNow()

      expect(manifestSince).toContain("0")
      expect(pointUploads).toBe(0)
      expect(await app.savedPointSyncState(accountB)).toMatchObject({
        cursor: 0,
        outboundIds: [],
        ownedIds: [],
      })
      expect(await app.savedPointSyncState(accountA)).toMatchObject({
        cursor: 123,
        outboundIds: [pointId],
      })

      await app.logOut()
      manifestSince.length = 0
      await app.signInAs(app.login)
      await app.syncNow()
      expect(manifestSince).toContain("123")
      expect(pointUploads).toBeGreaterThan(0)
      expect(await app.savedPointSyncState(accountA)).toMatchObject({
        outboundIds: [],
      })
      expect(
        ((await app.savedPointSyncState(accountA)) as { cursor: number }).cursor
      ).toBeGreaterThan(123)
    } finally {
      app.page.off("request", onRequest)
      await app.page.unroute("**/api/saved-points/manifest**")
    }
  })
})
