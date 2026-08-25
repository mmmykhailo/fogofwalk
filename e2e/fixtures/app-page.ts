import { expect, type Locator, type Page } from "@playwright/test"

import { makeGpxSet, type GpxFixture } from "./gpx"

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
export class AppPage {
  constructor(
    readonly page: Page,
    readonly login: string,
    private readonly approveAccess?: (login: string) => Promise<void>
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async goto() {
    await this.page.goto("/")
    await this.waitUntilReady()
  }

  async reload() {
    await this.page.reload()
    await this.waitUntilReady()
  }

  async waitUntilReady() {
    const uploadDialog = this.page.getByRole("dialog", {
      name: /Load activity files/i,
    })

    // On an empty library `FileUploadDialog` auto-opens. It is modal, so Base UI
    // marks the rest of the page aria-hidden — which means the readiness button
    // is invisible to role queries *even though* the app is ready. Wait for
    // whichever arrives, dismiss the dialog, then confirm.
    await expect(uploadDialog.or(this.openDrawerButton).first()).toBeVisible({
      timeout: 45_000,
    })

    if (await uploadDialog.isVisible().catch(() => false)) {
      await uploadDialog.getByRole("button", { name: "Skip for now" }).click()
      await expect(uploadDialog).toBeHidden()
    }

    await expect(this.openDrawerButton).toBeVisible({ timeout: 15_000 })
  }

  get openDrawerButton(): Locator {
    return this.page.getByRole("button", { name: "Open controls" })
  }

  /**
   * Scoped to `data-state="open"`. vaul keeps the drawer mounted while it
   * animates out, so a bare `[data-vaul-drawer]` reads as visible during the
   * close — which made `openDrawer` skip its click and every subsequent lookup
   * inside the drawer hang.
   */
  get drawer(): Locator {
    return this.page.locator('[data-vaul-drawer][data-state="open"]')
  }

  async openDrawer() {
    if (await this.drawer.isVisible().catch(() => false)) return
    await this.openDrawerButton.click()
    await expect(this.drawer).toBeVisible()
  }

  async closeDrawer() {
    if (!(await this.drawer.isVisible().catch(() => false))) return
    await this.page.keyboard.press("Escape")
    await expect(this.drawer).toBeHidden()
  }

  // ─── Activities ─────────────────────────────────────────────────────────────

  /** Number of activities the drawer reports. 0 when the status line is absent. */
  async activityCount(): Promise<number> {
    await this.openDrawer()
    const status = this.page.getByTestId("drawer-status")
    if (!(await status.isVisible().catch(() => false))) return 0
    const text = (await status.textContent()) ?? ""
    return Number(/(\d+)\s+activities?/.exec(text)?.[1] ?? 0)
  }

  async expectActivityCount(expected: number) {
    await this.openDrawer()
    const status = this.page.getByTestId("drawer-status")
    if (expected === 0) {
      await expect(status).toBeHidden()
      return
    }
    // A remote sync adds activities before the fog worker has rendered their
    // corridors. Wait with the same budget as the activity assertion below:
    // a short fixed delay races slower CI workers and reports a false download
    // failure even though the activities are already in the local library.
    if (((await status.textContent()) ?? "").includes("Processing")) {
      await expect(status).not.toContainText("Processing", { timeout: 30_000 })
    }
    await expect(status).toContainText(
      new RegExp(`\\b${expected} activit(?:y|ies)\\b`),
      { timeout: 30_000 }
    )
  }

  /** Imports GPX files through the real hidden file input. */
  async importFiles(files: GpxFixture[]) {
    await this.closeDrawer()
    await this.page
      .locator('input[type="file"][accept=".gpx,.fit"]')
      .first()
      .setInputFiles(
        files.map((f) => ({
          name: f.name,
          mimeType: f.mimeType,
          buffer: f.buffer,
        }))
      )
  }

  importActivities(count: number, seedOffset = 0) {
    return this.importFiles(makeGpxSet(count, seedOffset))
  }

  /** Waits for the fog worker to finish, i.e. the progress indicator to clear. */
  async waitForImportToSettle() {
    await this.openDrawer()
    await expect(this.page.getByTestId("drawer-status")).not.toContainText(
      /Processing/,
      { timeout: 45_000 }
    )
  }

  // ─── Account ────────────────────────────────────────────────────────────

  get accountRow(): Locator {
    return this.page.getByTestId("account-row")
  }

  get signInRow(): Locator {
    return this.drawer.getByRole("button", { name: "Sign in" })
  }

  /** Creates a local test account through the same sign-in UI as a developer. */
  async signIn() {
    await this.openDrawer()
    await this.signInRow.click()
    const dialog = this.page.getByRole("dialog", { name: "Sign in" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Local test-user name").fill(this.login)
    await dialog.getByRole("button", { name: "Create" }).click()
    await this.waitUntilReady()
    await this.openDrawer()
    await expect(this.accountRow).toBeVisible({ timeout: 30_000 })

    if (
      this.approveAccess &&
      (await this.accountRow.textContent())?.includes("Not enabled for sync")
    ) {
      const account = await this.openAccountDialog()
      await account.getByRole("button", { name: "Request access" }).click()
      await expect(account.getByText("Access request pending")).toBeVisible()
      await this.approveAccess(this.login)
      await this.reload()
      await this.openDrawer()
      await expect(this.accountRow).not.toContainText("Not enabled for sync")
    }
  }

  async openAccountDialog(): Promise<Locator> {
    await this.openDrawer()
    await this.accountRow.click()
    const dialog = this.page.getByRole("dialog", { name: "Account" })
    await expect(dialog).toBeVisible()
    return dialog
  }

  /** The account row's subtitle: sync status, "Sync paused …", "Not enabled …". */
  async accountRowDescription(): Promise<string> {
    await this.openDrawer()
    return (await this.accountRow.textContent()) ?? ""
  }

  async syncNow() {
    const dialog = await this.openAccountDialog()
    await dialog.getByTestId("sync-now").click()
    await expect(dialog.getByTestId("sync-now")).not.toContainText("Syncing", {
      timeout: 30_000,
    })
    await this.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  }

  // ─── Destructive actions ────────────────────────────────────────────────

  async clearAll() {
    await this.openDrawer()
    await this.drawer.getByRole("button", { name: "Clear all" }).click()
    const dialog = this.page.getByRole("dialog", { name: /Clear all data/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Clear all" }).click()
    await expect(dialog).toBeHidden()
  }

  async removeAllFromServer(): Promise<void> {
    const dialog = await this.openAccountDialog()
    await dialog.getByRole("button", { name: "Remove all" }).click()
    await dialog.getByRole("button", { name: /Remove from server/ }).click()
    await expect(dialog.getByText(/Removed \d+ activity/)).toBeVisible({
      timeout: 30_000,
    })
    await this.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  }

  async deleteAccount() {
    const dialog = await this.openAccountDialog()
    await dialog.getByRole("button", { name: "Delete account" }).click()
    await expect(dialog.getByText("Delete your account?")).toBeVisible()
    await dialog.getByRole("button", { name: /Delete permanently/ }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
  }

  async logOut() {
    const dialog = await this.openAccountDialog()
    await dialog.getByRole("button", { name: /Log out/ }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
  }

  /** Local activity ids and names, read from IndexedDB. */
  async localActivities(): Promise<{ id: string; name: string }[]> {
    return this.page.evaluate(async () => {
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
  }

  /**
   * Selects an activity and deletes it. `alsoOnServer` drives the switch deciding
   * whether the server copy goes too.
   *
   * Selection goes through the `?activity=<id>` deep link rather than clicking the
   * map: with tiles stubbed out there is nothing to aim at, and hit-testing a
   * polyline at a guessed pixel would be the flakiest thing in the suite.
   */
  async deleteActivity(activityName: string, alsoOnServer: boolean) {
    const activities = await this.localActivities()
    const target = activities.find((t) => t.name === activityName)
    if (!target) {
      throw new Error(
        `no local activity named ${activityName}; have ${activities.map((t) => t.name).join(", ")}`
      )
    }

    await this.closeDrawer()
    await this.page.goto(`/?activity=${encodeURIComponent(target.id)}`)
    await this.waitUntilReady()

    const deleteButton = this.page.getByRole("button", {
      name: "Delete activity",
    })
    await expect(deleteButton).toBeVisible({ timeout: 20_000 })
    await deleteButton.click()

    const dialog = this.page.getByRole("dialog", {
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
  }

  // ─── Sync triggers ──────────────────────────────────────────────────────

  /** Fires the automatic triggers the scheduler listens for. */
  async fireAutomaticSyncTriggers() {
    await this.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("online"))
    })
    // Sync is kicked off synchronously by the event handlers. A short pause
    // gives a regression time to complete its local manifest request without
    // making each suspension check idle for seconds.
    await this.page.waitForTimeout(300)
  }
}
