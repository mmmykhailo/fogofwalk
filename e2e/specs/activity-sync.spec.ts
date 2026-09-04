import { readSessionToken, test, expect } from "../fixtures/app"
import { makeGpxSet } from "../fixtures/gpx"
import { API_URL } from "../fixtures/ports"

async function queuedActivityUpdates(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const queued = await new Promise<string[]>((resolve) => {
      const transaction = db.transaction("prefs", "readonly")
      const request = transaction.objectStore("prefs").get("syncState")
      request.onsuccess = () =>
        resolve(
          Object.keys(request.result?.value?.outboundActivityMetadata ?? {})
        )
      request.onerror = () => resolve([])
    })
    db.close()
    return queued
  })
}

async function activityContentHash(
  page: import("@playwright/test").Page,
  id: string
): Promise<string> {
  return page.evaluate(async (activityId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const hash = await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction("activities", "readonly")
      const request = transaction.objectStore("activities").get(activityId)
      request.onsuccess = () => resolve(request.result?.contentHash ?? "")
      request.onerror = () => reject(request.error)
    })
    db.close()
    return hash
  }, id)
}

test.describe("activity sync", () => {
  test("imported activities are uploaded to the server", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(3)
    await app.waitForImportToSettle()
    await app.expectActivityCount(3)

    await app.syncNow()

    const state = await serverState(app.page)
    expect(state.activities.map((t) => t.name).sort()).toEqual([
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
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    const deviceB = await secondDevice(app.login)
    await deviceB.goto()
    await deviceB.signIn()

    // Signing in triggers a sync on its own; give it the chance before nudging.
    await deviceB.syncNow()
    await deviceB.expectActivityCount(2)
  })

  test("an activity added on the second device reaches the first", async ({
    app,
    secondDevice,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    const deviceB = await secondDevice(app.login)
    await deviceB.goto()
    await deviceB.signIn()
    await deviceB.syncNow()
    await deviceB.expectActivityCount(1)

    // B imports something new…
    await deviceB.importFiles(makeGpxSet(1, 50))
    await deviceB.waitForImportToSettle()
    await deviceB.syncNow()

    // …and A picks it up.
    await app.syncNow()
    await app.expectActivityCount(2)
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
    await app.expectActivityCount(3)

    await app.importFiles(files)

    const dialog = app.page.getByRole("dialog", {
      name: /Activities already added/,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      "All 3 activities are already on your map"
    )
    await app.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    // Still three, and crucially not stuck on "Processing".
    await app.expectActivityCount(3)
    await expect(app.page.getByTestId("drawer-status")).not.toContainText(
      "Processing"
    )
  })

  test("a partial re-import adds only the new activities", async ({ app }) => {
    await app.goto()
    await app.signIn()
    await app.importFiles(makeGpxSet(2))
    await app.waitForImportToSettle()
    await app.expectActivityCount(2)

    // t1 and t2 again, plus two it has never seen.
    await app.importFiles([...makeGpxSet(2), ...makeGpxSet(2, 10)])
    await app.waitForImportToSettle()

    await app.expectActivityCount(4)
  })

  test("activities survive a reload without re-uploading", async ({
    app,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.reload()
    await app.expectActivityCount(2)
    await app.syncNow()

    // Two activities, not four — the content hash is the identity, not the row.
    expect((await serverState(app.page)).activities).toHaveLength(2)
  })

  test("commits metadata offline, queues it, and syncs it to another device", async ({
    app,
    secondDevice,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    const local = await app.localActivities()
    const activity = local[0]!
    const contentHash = await activityContentHash(app.page, activity.id)
    await app.page.goto("/activities")
    await expect(
      app.page.getByRole("heading", { name: "My activities" })
    ).toBeVisible()

    let releaseUpload!: () => void
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    let uploadStarted!: () => void
    const uploadRequest = new Promise<void>((resolve) => {
      uploadStarted = resolve
    })
    let uploadFinished!: () => void
    const uploadCompletion = new Promise<void>((resolve) => {
      uploadFinished = resolve
    })
    let metadataPayload: unknown
    const holdUpload = async (route: import("@playwright/test").Route) => {
      if (
        route.request().method() !== "PATCH" ||
        !route.request().url().endsWith("/api/activities/metadata")
      )
        return route.fallback()
      metadataPayload = route.request().postDataJSON()
      uploadStarted()
      await uploadGate
      try {
        await route.abort()
      } finally {
        uploadFinished()
      }
    }
    await app.page.route(`${API_URL}/api/activities/*`, holdUpload)

    const typeSelect = app.page.getByRole("combobox", {
      name: `Activity type for ${activity.name}`,
    })
    await typeSelect.click()
    await app.page.getByRole("option", { name: "Cycling", exact: true }).click()

    // The route action returns while the background metadata upload is still held.
    await Promise.all([
      uploadRequest,
      expect(typeSelect).toBeEnabled({ timeout: 5_000 }),
    ])
    await expect
      .poll(() => queuedActivityUpdates(app.page))
      .toContain(contentHash)
    expect(metadataPayload).toMatchObject({
      updates: [{ contentHash, activityType: "cycling" }],
    })
    expect(JSON.stringify(metadataPayload)).not.toContain("coordinates")

    // A second offline edit replaces the first value in the persisted
    // last-write-wins outbox while the first request is still unresolved.
    await typeSelect.click()
    await app.page.getByRole("option", { name: "Running", exact: true }).click()
    await expect(typeSelect).toContainText("Running")
    await expect
      .poll(() => queuedActivityUpdates(app.page))
      .toContain(contentHash)

    releaseUpload()
    await uploadCompletion
    await app.page.unroute(`${API_URL}/api/activities/*`, holdUpload)
    await app.page.reload()
    await expect(
      app.page.getByRole("heading", { name: "My activities" })
    ).toBeVisible()

    // Returning to the map is an ordinary later sync trigger; it drains the
    // queued metadata patch through the existing upload gate.
    await app.goto()
    await app.syncNow()
    await expect.poll(() => queuedActivityUpdates(app.page)).toEqual([])
    await expect
      .poll(async () => {
        const response = await app.page.request.get(
          `${API_URL}/api/activities/manifest?since=0`,
          {
            headers: {
              Authorization: `Bearer ${await readSessionToken(app.page)}`,
            },
          }
        )
        if (!response.ok()) return null
        const profile = (await response.json()) as {
          activities: { contentHash: string; activityType?: string }[]
        }
        return profile.activities.find(
          (item) => item.contentHash === contentHash
        )
      })
      .toMatchObject({ activityType: "running" })

    const deviceB = await secondDevice(app.login)
    await deviceB.goto()
    await deviceB.signIn()
    await deviceB.syncNow()
    await deviceB.page.goto("/activities")
    const deviceBActivity = (await deviceB.localActivities()).find(
      (item) => item.name === activity.name
    )!
    await expect(
      deviceB.page.getByTestId(`activity-card-${deviceBActivity.id}`)
    ).toBeVisible()
    await expect(
      deviceB.page.getByRole("combobox", {
        name: `Activity type for ${activity.name}`,
      })
    ).toContainText("Running")
  })
})
