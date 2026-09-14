import { expect, test } from "../fixtures/app"
import { createAppPage } from "../fixtures/app-page"
import {
  diffPerformanceCounters,
  installPerformanceCounters,
  readPerformanceCounters,
  waitForMapIdle,
} from "../fixtures/performance"

async function prepareSyncedActivity(
  app: ReturnType<typeof createAppPage>
): Promise<{ id: string; name: string }> {
  await app.goto()
  await app.signIn()
  await app.importActivities(1)
  await app.waitForImportToSettle()
  await app.syncNow()
  return (await app.localActivities())[0]!
}

async function corruptLibraryMeta(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fogofwalk")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("library-meta", "readwrite")
      transaction.objectStore("library-meta").put({
        key: "library",
        schemaVersion: 2,
        revision: -1,
        coverageRevision: -1,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
  })
}

test.describe("activity metadata interactions", () => {
  test("edits map visibility optimistically without geometry work", async ({
    app,
  }) => {
    await installPerformanceCounters(app.page)
    const activity = await prepareSyncedActivity(app)
    await app.page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
    await app.waitUntilReady()

    const visibility = app.page.getByRole("combobox", {
      name: `Visibility for ${activity.name}`,
    })
    await expect(visibility).toBeVisible()
    await waitForMapIdle(app.page)
    const before = await readPerformanceCounters(app.page)

    await visibility.click()
    await app.page.getByRole("option", { name: "Public", exact: true }).click()
    await app.page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    await expect(visibility).toContainText("Public")

    const delta = diffPerformanceCounters(
      before,
      await readPerformanceCounters(app.page)
    )
    expect(delta.homeLoaderStarts).toBe(0)
    expect(delta.homeBootstrapStarts).toBe(0)
    expect(delta.fullActivityLoads).toBe(0)
    expect(delta.uniqueDistanceWorkerRequests).toBe(0)
    expect(delta.fogWorkerRebuildRequests).toBe(0)
    expect(delta.fogWorkerAppendRequests).toBe(0)
    expect(delta.mapSourceSetDataCalls).toBe(0)
    expect(delta.activityPaintUpdates).toBe(0)
    expect(delta.mapUiNavigations).toBe(0)
    expect(delta.idbGetAllCalls.activities ?? 0).toBe(0)
    expect(delta.idbGetCalls.activities ?? 0).toBe(0)
    expect(delta.idbWriteCalls.activities ?? 0).toBe(0)
    expect(delta.idbWriteCalls["activity-summaries"] ?? 0).toBe(1)
    expect(delta.idbWriteCalls["library-meta"] ?? 0).toBe(1)
  })

  test("rolls back the optimistic value when the local metadata transaction fails", async ({
    app,
  }) => {
    await installPerformanceCounters(app.page)
    const activity = await prepareSyncedActivity(app)
    await app.page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
    await app.waitUntilReady()

    const visibility = app.page.getByRole("combobox", {
      name: `Visibility for ${activity.name}`,
    })
    await expect(visibility).toBeVisible()
    await corruptLibraryMeta(app.page)

    await visibility.click()
    await app.page.getByRole("option", { name: "Public", exact: true }).click()
    await expect(visibility).toContainText("Private", { timeout: 10_000 })
    await expect(app.page.getByRole("alert")).toContainText(
      "metadata is invalid"
    )
    await expect(visibility).toBeVisible()
  })

  test("broadcasts metadata to a second map tab without fog work", async ({
    app,
  }) => {
    await installPerformanceCounters(app.page)
    const activity = await prepareSyncedActivity(app)
    await app.page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
    await app.waitUntilReady()

    const secondPage = await app.page.context().newPage()
    try {
      await secondPage.emulateMedia({ reducedMotion: "reduce" })
      await installPerformanceCounters(secondPage)
      const second = createAppPage(secondPage, app.login)
      await secondPage.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
      await second.waitUntilReady()

      const firstVisibility = app.page.getByRole("combobox", {
        name: `Visibility for ${activity.name}`,
      })
      const secondVisibility = secondPage.getByRole("combobox", {
        name: `Visibility for ${activity.name}`,
      })
      await expect(firstVisibility).toBeVisible()
      await expect(secondVisibility).toBeVisible()
      await waitForMapIdle(secondPage)
      const before = await readPerformanceCounters(secondPage)

      await firstVisibility.click()
      await app.page
        .getByRole("option", { name: "Public", exact: true })
        .click()
      await expect(firstVisibility).toContainText("Public")
      await expect(secondVisibility).toContainText("Public", {
        timeout: 10_000,
      })

      const delta = diffPerformanceCounters(
        before,
        await readPerformanceCounters(secondPage)
      )
      expect(delta.fullActivityLoads).toBe(0)
      expect(delta.uniqueDistanceWorkerRequests).toBe(0)
      expect(delta.fogWorkerRebuildRequests).toBe(0)
      expect(delta.fogWorkerAppendRequests).toBe(0)
      expect(delta.mapSourceSetDataCalls).toBe(0)
      expect(delta.activityPaintUpdates).toBe(0)
      expect(delta.mapUiNavigations).toBe(0)
      expect(delta.idbGetAllCalls.activities ?? 0).toBe(0)
      expect(delta.idbGetCalls.activities ?? 0).toBe(0)
    } finally {
      await secondPage.close()
    }
  })
})
