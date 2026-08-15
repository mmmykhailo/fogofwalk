import { test, expect } from "../fixtures/app"

const PUBLIC_PROFILE_URL = (handle: string) => `/u/${handle}`

/**
 * Public profiles are a server-only feature: the URL is intentionally
 * unlinked from the app, but anyone who knows it can see the user's avatar,
 * handle and any tracks the user marked public.
 */
test.describe("public profile", () => {
  test("a private track does not appear on the public profile", async ({
    app,
    login,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(app.page.locator("h2").getByText(`E2E ${login}`)).toBeVisible()
    await expect(
      app.page.getByText("This user has no public tracks yet")
    ).toBeVisible()
  })

  test("publishing a track makes it visible on the public profile", async ({
    app,
    login,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importTracks(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    const [{ id }] = await app.localTracks()
    await app.page.goto(`/?track=${encodeURIComponent(id)}`)
    await app.waitUntilReady()

    // Toggle visibility from Private to Public.
    await app.page.getByRole("combobox", { name: "Track visibility" }).click()
    await app.page.getByRole("option", { name: "Public" }).click()

    // Wait for the debounced server patch + IDB save.
    await app.page.waitForTimeout(900)

    // Publish should show on the public profile.
    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(app.page.locator("h2").getByText(`E2E ${login}`)).toBeVisible()
    await expect(app.page.getByText("t1")).toBeVisible()
    await expect(app.page.getByText(/^\d+(\.\d+)? km$/)).toBeVisible()
  })
})
