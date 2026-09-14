import { expect, type Locator, type Page } from "@playwright/test"

import { makeGpxSet, type GpxFixture } from "./gpx"

// Keep this browser-side mirror aligned with the production interactive-target
// registry. The E2E page object cannot import app modules because Playwright
// executes it outside Vite's `~` alias environment.
const INTERACTIVE_MAP_LAYER_IDS = [
  "saved-points-hit-layer",
  "activities-hit-layer",
] as const
const MAP_INTERACTIVE_MARKER_SELECTOR = "[data-map-interactive]"

/**
 * Page object for the map screen.
 *
 * Two app behaviours it hides from every spec:
 * - Nothing is interactive until MapLibre fires `load`; the "Open controls"
 *   button is the only element that exists solely once `mapReady` is true, so
 *   it is the readiness signal.
 * - `MoreDrawer` closes itself and opens dialogs on a 250–300 ms timer, so a
 *   click is never synchronous with the dialog appearing. Every helper waits on
 *   the dialog rather than assuming.
 */
export type AppPage = ReturnType<typeof createAppPage>

export function createAppPage(
  page: Page,
  login: string,
  approveAccess?: (login: string) => Promise<void>
) {
  const openDrawerButton = page.getByRole("button", { name: "Open controls" })
  const drawer = page.locator('[data-vaul-drawer][data-state="open"]')
  const accountRow = page.getByTestId("account-row")
  const signInRow = drawer.getByRole("button", { name: "Sign in" })

  const app = {
    page,
    login,
    openDrawerButton,
    drawer,
    accountRow,
    signInRow,

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    async goto() {
      await page.goto("/map")
      await app.waitUntilReady()
    },

    async reload() {
      await page.reload()
      await app.waitUntilReady()
    },

    async waitUntilReady() {
      const uploadDialog = page.getByRole("dialog", {
        name: /Load activity files/i,
      })

      // On an empty library `FileUploadDialog` auto-opens. It is modal, so Base UI
      // marks the rest of the page aria-hidden — which means the readiness button
      // is invisible to role queries *even though* the app is ready. Wait for
      // whichever arrives, dismiss the dialog, then confirm.
      await expect(uploadDialog.or(openDrawerButton).first()).toBeVisible({
        timeout: 45_000,
      })

      if (await uploadDialog.isVisible().catch(() => false)) {
        await uploadDialog.getByRole("button", { name: "Skip for now" }).click()
        await expect(uploadDialog).toBeHidden()
      }

      await expect(openDrawerButton).toBeVisible({ timeout: 15_000 })
    },

    /** Seeds a persisted photo without depending on EXIF parsing in the test. */
    async seedPhoto(photo: {
      id: string
      takenAtMs: number
      lng: number
      lat: number
      fileName?: string
    }): Promise<void> {
      await page.evaluate(async (entry) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fogofwalk")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const image = new Uint8Array([
          71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0,
          33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1,
          0, 59,
        ])
        const file = new File([image], entry.fileName ?? "e2e-photo.gif", {
          type: "image/gif",
          lastModified: entry.takenAtMs,
        })
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("photos", "readwrite")
          transaction.objectStore("photos").put({
            id: entry.id,
            file,
            takenAtMs: entry.takenAtMs,
            lng: entry.lng,
            lat: entry.lat,
          })
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
        db.close()
      }, photo)
    },

    /** Clicks a canvas location verified to have no registered map target. */
    async clickMapBackground(): Promise<void> {
      const canvas = page.locator(".maplibregl-canvas").first()
      const point = await page.evaluate(
        ({ layerIds, markerSelector }) => {
          const map = window.__fogofwalkE2eMap
          if (!map) throw new Error("MapLibre test handle is unavailable")
          const mapCanvas = map.getCanvas()
          const bounds = mapCanvas.getBoundingClientRect()
          const mapRoot = mapCanvas.closest(".maplibregl-map")
          if (!mapRoot) throw new Error("MapLibre map root is unavailable")
          const fractions = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]
          const diagnostics: unknown[] = []
          const installedLayerIds = layerIds.filter((layerId) => {
            try {
              return Boolean(map.getLayer(layerId))
            } catch {
              return false
            }
          })

          for (const xFraction of fractions) {
            for (const yFraction of fractions) {
              const x = Math.floor(bounds.width * xFraction)
              const y = Math.floor(bounds.height * yFraction)
              if (installedLayerIds.length > 0) {
                let features: unknown[]
                try {
                  features = map.queryRenderedFeatures([x, y], {
                    layers: installedLayerIds,
                  })
                } catch {
                  // A style transition makes this candidate unverifiable. Keep
                  // looking rather than risking a click on a route.
                  diagnostics.push({ x, y, query: "error" })
                  continue
                }
                if (features.length > 0) {
                  diagnostics.push({ x, y, features: features.length })
                  continue
                }
              }

              const element = document.elementFromPoint(
                bounds.left + x,
                bounds.top + y
              )
              if (!element || !mapRoot.contains(element)) {
                diagnostics.push({
                  x,
                  y,
                  element: element
                    ? `${element.tagName}.${element.className}`
                    : null,
                })
                continue
              }
              if (element.closest(".maplibregl-marker")) {
                diagnostics.push({ x, y, element: "marker" })
                continue
              }
              if (element.closest(markerSelector)) {
                diagnostics.push({ x, y, element: "interactive-marker" })
                continue
              }
              return { x, y }
            }
          }

          throw new Error(
            `Could not find an empty map canvas point outside registered interactive targets: ${JSON.stringify(diagnostics.slice(0, 5))}`
          )
        },
        {
          layerIds: INTERACTIVE_MAP_LAYER_IDS,
          markerSelector: MAP_INTERACTIVE_MARKER_SELECTOR,
        }
      )
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error("Map canvas is not visible")
      await page.mouse.click(bounds.x + point.x, bounds.y + point.y)
    },

    /** Projects a map coordinate through MapLibre before clicking the canvas. */
    async clickMapCoordinate(coordinate: [number, number]): Promise<void> {
      const canvas = page.locator(".maplibregl-canvas").first()
      const point = await page.evaluate((lngLat) => {
        const map = window.__fogofwalkE2eMap
        if (!map) throw new Error("MapLibre test handle is unavailable")
        const projected = map.project(lngLat)
        return { x: projected.x, y: projected.y }
      }, coordinate)
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error("Map canvas is not visible")
      await page.mouse.click(bounds.x + point.x, bounds.y + point.y)
    },

    async openDrawer() {
      if (await drawer.isVisible().catch(() => false)) return
      await openDrawerButton.click()
      await expect(drawer).toBeVisible()
    },

    async closeDrawer() {
      if (!(await drawer.isVisible().catch(() => false))) return
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
    },

    // ─── Activities ─────────────────────────────────────────────────────────────

    /** Number of activities the drawer reports. 0 when the status line is absent. */
    async activityCount(): Promise<number> {
      await app.openDrawer()
      const status = page.getByTestId("drawer-status")
      if (!(await status.isVisible().catch(() => false))) return 0
      const text = (await status.textContent()) ?? ""
      return Number(/(\d+)\s+activities?/.exec(text)?.[1] ?? 0)
    },

    async expectActivityCount(expected: number) {
      await app.openDrawer()
      const status = page.getByTestId("drawer-status")
      if (expected === 0) {
        await expect(status).toBeHidden()
        return
      }
      // A remote sync adds activities before the fog worker has rendered their
      // corridors. Wait with the same budget as the activity assertion below:
      // a short fixed delay races slower CI workers and reports a false download
      // failure even though the activities are already in the local library.
      if (((await status.textContent()) ?? "").includes("Processing")) {
        await expect(status).not.toContainText("Processing", {
          timeout: 30_000,
        })
      }
      await expect(status).toContainText(
        new RegExp(`\\b${expected} activit(?:y|ies)\\b`),
        { timeout: 30_000 }
      )
    },

    /** Imports GPX files through the real hidden file input. */
    async importFiles(files: GpxFixture[]) {
      await app.closeDrawer()
      await page
        .locator('input[type="file"][accept=".gpx,.fit"]')
        .first()
        .setInputFiles(
          files.map((f) => ({
            name: f.name,
            mimeType: f.mimeType,
            buffer: f.buffer,
          }))
        )
    },

    importActivities(count: number, seedOffset = 0) {
      return app.importFiles(makeGpxSet(count, seedOffset))
    },

    /** Waits for the fog worker to finish, i.e. the progress indicator to clear. */
    async waitForImportToSettle() {
      await app.openDrawer()
      await expect(page.getByTestId("drawer-status")).not.toContainText(
        /Processing/,
        { timeout: 45_000 }
      )
    },

    // ─── Account ────────────────────────────────────────────────────────────

    /** Creates a local test account through the same sign-in UI as a developer. */
    async signIn() {
      await app.signInAs(login)
    },

    async signInAs(accountLogin: string) {
      await app.openDrawer()
      await signInRow.click()
      await expect(drawer).toBeHidden()
      const dialog = page.getByRole("dialog", { name: "Sign in" })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel("Local test-user name").fill(accountLogin)
      await dialog.getByRole("button", { name: "Create" }).click()
      await app.waitUntilReady()
      await app.openDrawer()
      await expect(accountRow).toBeVisible({ timeout: 30_000 })

      if (
        approveAccess &&
        (await accountRow.textContent())?.includes("Not enabled for sync")
      ) {
        const account = await app.openAccountDialog()
        await account.getByRole("button", { name: "Request access" }).click()
        await expect(account.getByText("Access request pending")).toBeVisible()
        await approveAccess(accountLogin)
        await app.reload()
        await app.openDrawer()
        await expect(accountRow).not.toContainText("Not enabled for sync")
      }
    },

    /** Reads the stable server user id from the cached session. */
    async sessionUserId(): Promise<string> {
      const userId = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fogofwalk")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const session = await new Promise<any>((resolve) => {
          const transaction = db.transaction("prefs", "readonly")
          const request = transaction.objectStore("prefs").get("session")
          request.onsuccess = () => resolve(request.result?.value ?? null)
          request.onerror = () => resolve(null)
        })
        db.close()
        return session?.user?.id ?? null
      })
      if (typeof userId !== "string") {
        throw new Error("no signed-in user id in IndexedDB")
      }
      return userId
    },

    /** Seeds account-scoped saved-point state for an isolation regression. */
    async seedSavedPointSyncState(
      accountId: string,
      state: {
        cursor: number
        lastSyncAt: number
        serverPointIds: string[]
        ownedIds: string[]
        appliedTombstones: Record<string, number>
        outboundIds: string[]
        outboundDeletionIds: string[]
      }
    ): Promise<void> {
      await page.evaluate(
        async ({ accountId: id, state: value }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("fogofwalk")
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("prefs", "readwrite")
            transaction.objectStore("prefs").put({
              key: `savedPointSyncState:${encodeURIComponent(id)}`,
              value,
            })
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error)
          })
          db.close()
        },
        { accountId, state }
      )
    },

    /** Reads one account's saved-point state from the browser database. */
    async savedPointSyncState(accountId: string): Promise<unknown | null> {
      return page.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fogofwalk")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const entry = await new Promise<any>((resolve) => {
          const transaction = db.transaction("prefs", "readonly")
          const request = transaction
            .objectStore("prefs")
            .get(`savedPointSyncState:${encodeURIComponent(id)}`)
          request.onsuccess = () => resolve(request.result?.value ?? null)
          request.onerror = () => resolve(null)
        })
        db.close()
        return entry
      }, accountId)
    },

    async openAccountDialog(): Promise<Locator> {
      await app.openDrawer()
      await accountRow.click()
      await expect(drawer).toBeHidden()
      const dialog = page.getByRole("dialog", { name: "Account" })
      await expect(dialog).toBeVisible()
      return dialog
    },

    /** The account row's subtitle: sync status, "Sync paused …", "Not enabled …". */
    async accountRowDescription(): Promise<string> {
      await app.openDrawer()
      return (await accountRow.textContent()) ?? ""
    },

    async syncNow() {
      const dialog = await app.openAccountDialog()
      const button = dialog.getByTestId("sync-now")
      const manifestResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes("/api/activities/manifest")
      )
      await button.click()
      await manifestResponse
      await expect(button).toBeEnabled({ timeout: 30_000 })
      await expect(button).not.toContainText("Syncing", { timeout: 30_000 })
      await dialog.getByRole("button", { name: "Close" }).click()
      await expect(dialog).toBeHidden()
    },

    // ─── Destructive actions ────────────────────────────────────────────────

    async clearAll() {
      await app.openDrawer()
      await drawer.getByRole("button", { name: "Clear all" }).click()
      const dialog = page.getByRole("dialog", { name: /Clear all data/ })
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Clear all" }).click()
      await expect(dialog).toBeHidden()
    },

    async removeAllFromServer(): Promise<void> {
      const dialog = await app.openAccountDialog()
      await dialog.getByRole("button", { name: "Remove all" }).click()
      await dialog.getByRole("button", { name: /Remove from server/ }).click()
      await expect(dialog.getByText(/Removed \d+ activity/)).toBeVisible({
        timeout: 30_000,
      })
      await dialog.getByRole("button", { name: "Close" }).click()
      await expect(dialog).toBeHidden()
    },

    async deleteAccount() {
      const dialog = await app.openAccountDialog()
      await dialog.getByRole("button", { name: "Delete account" }).click()
      await expect(dialog.getByText("Delete your account?")).toBeVisible()
      await dialog.getByRole("button", { name: /Delete permanently/ }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
    },

    async logOut() {
      const dialog = await app.openAccountDialog()
      await dialog.getByRole("button", { name: /Log out/ }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
    },

    /** Local activity ids and names, read from IndexedDB. */
    async localActivities(): Promise<{ id: string; name: string }[]> {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("fogofwalk")
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        return new Promise<{ id: string; name: string }[]>((resolve) => {
          const tx = db.transaction("activities", "readonly")
          const all = tx.objectStore("activities").getAll()
          all.onsuccess = () =>
            resolve(all.result.map((t: any) => ({ id: t.id, name: t.name })))
          all.onerror = () => resolve([])
        })
      })
    },

    /** Summary of the persisted fog geometry, for cache/worker convergence tests. */
    async fogCacheSummary(): Promise<{
      activityIds: string[]
      fogMode: "corridor" | "fill"
      ringCount: number
      algorithmVersion: number
      partitionSchemeVersion: number
      completeness: "complete" | string | undefined
    } | null> {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("fogofwalk")
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        const entry = await new Promise<any>((resolve) => {
          const tx = db.transaction("prefs", "readonly")
          const request = tx.objectStore("prefs").get("fogCache")
          request.onsuccess = () => resolve(request.result?.value ?? null)
          request.onerror = () => resolve(null)
        })
        if (!entry) return null

        const ringCount = entry.fogData.features.reduce(
          (sum: number, feature: any) => {
            const geometry = feature.geometry
            if (geometry.type === "Polygon") {
              return sum + geometry.coordinates.length
            }
            return (
              sum +
              geometry.coordinates.reduce(
                (polygonSum: number, polygon: unknown[]) =>
                  polygonSum + polygon.length,
                0
              )
            )
          },
          0
        )
        return {
          activityIds: entry.activityIds,
          fogMode: entry.fogMode,
          ringCount,
          algorithmVersion: entry.algorithmVersion,
          partitionSchemeVersion: entry.partitionSchemeVersion,
          completeness: entry.completeness,
        }
      })
    },

    /**
     * Selects an activity and deletes it. `alsoOnServer` drives the switch deciding
     * whether the server copy goes too.
     *
     * Selection goes through the `?activity=<id>` deep link rather than clicking the
     * map: with tiles stubbed out there is nothing to aim at, and hit-testing a
     * polyline at a guessed pixel would be the flakiest thing in the suite.
     */
    async deleteActivity(activityName: string, alsoOnServer: boolean) {
      const activities = await app.localActivities()
      const target = activities.find((t) => t.name === activityName)
      if (!target) {
        throw new Error(
          `no local activity named ${activityName}; have ${activities.map((t) => t.name).join(", ")}`
        )
      }

      await app.closeDrawer()
      await page.goto(`/map?activity=${encodeURIComponent(target.id)}`)
      await app.waitUntilReady()

      const deleteButton = page.getByRole("button", {
        name: "Delete activity",
      })
      await expect(deleteButton).toBeVisible({ timeout: 20_000 })
      await deleteButton.click()

      const dialog = page.getByRole("dialog", {
        name: /Delete this activity/,
      })
      await expect(dialog).toBeVisible()
      const toggle = dialog.getByRole("switch", {
        name: "Delete from the server too",
      })
      if (await toggle.isVisible().catch(() => false)) {
        const isOn = (await toggle.getAttribute("data-checked")) !== null
        if (isOn !== alsoOnServer) await toggle.click()
      }
      await dialog.getByRole("button", { name: "Delete", exact: true }).click()
      await expect(dialog).toBeHidden()
    },

    // ─── Sync triggers ──────────────────────────────────────────────────────

    /** Fires the automatic triggers the scheduler listens for. */
    async fireAutomaticSyncTriggers() {
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"))
        document.dispatchEvent(new Event("visibilitychange"))
        window.dispatchEvent(new Event("online"))
      })
      // Sync is kicked off synchronously by the event handlers. A short pause
      // gives a regression time to complete its local manifest request without
      // making each suspension check idle for seconds.
      await page.waitForTimeout(300)
    },

    /** Seeds a local saved point so UI tests can open its editor without a map gesture. */
    async seedSavedPoint(point: {
      id: string
      lng: number
      lat: number
      name: string
      description: string | null
      color: string
      isPublic: boolean
      createdAt: number
      updatedAt: number
    }): Promise<void> {
      await page.evaluate(async (savedPoint) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fogofwalk")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("saved-points", "readwrite")
          transaction.objectStore("saved-points").put(savedPoint)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
        db.close()
      }, point)
    },

    /** Reads the persisted saved points, including selections made by the editor. */
    async localSavedPoints(): Promise<
      {
        id: string
        name: string
        color: string
        isPublic: boolean
      }[]
    > {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fogofwalk")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const points = await new Promise<
          { id: string; name: string; color: string; isPublic: boolean }[]
        >((resolve, reject) => {
          const transaction = db.transaction("saved-points", "readonly")
          const request = transaction.objectStore("saved-points").getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        db.close()
        return points
      })
    },
  }

  return app
}
