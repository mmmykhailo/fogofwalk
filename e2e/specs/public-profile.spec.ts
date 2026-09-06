import { test, expect, readSessionToken } from "../fixtures/app"
import { API_URL } from "../fixtures/ports"

const PUBLIC_PROFILE_URL = (handle: string) => `/u/${handle}`

/**
 * Public profiles are a server-only feature: the URL is intentionally
 * unlinked from the app, but anyone who knows it can see the user's avatar,
 * handle and any activities the user marked public.
 */
test.describe("public profile", () => {
  test("opens the profile from the cached map", async ({ app, login }) => {
    await app.goto()
    await app.signIn()
    await app.openDrawer()
    await app.drawer.getByRole("link", { name: "My public profile" }).click()

    await expect(app.page).toHaveURL(new RegExp(`/u/${login}$`))
    await expect(app.page.getByText(`@${login}`)).toBeVisible()
  })

  test("a private activity does not appear on the public profile", async ({
    app,
    login,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(app.page.locator("h1").getByText(login)).toBeVisible()
    await expect(
      app.page.getByText("This user has no public activities yet")
    ).toBeVisible()
  })

  test("publishing an activity makes it visible on the public profile", async ({
    app,
    login,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    const [{ id }] = await app.localActivities()
    await app.page.goto(`/map?activity=${encodeURIComponent(id)}`)
    await app.waitUntilReady()

    // Toggle visibility from Private to Public and wait for the debounced
    // visibility PATCH to actually land, rather than sleeping a guessed delay.
    const visibilityPatch = app.page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" && res.url().includes("/visibility")
    )
    await app.page
      .getByRole("combobox", { name: "Activity visibility" })
      .click()
    await app.page.getByRole("option", { name: "Public" }).click()
    await visibilityPatch

    // Publish should show on the public profile.
    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(app.page.locator("h1").getByText(login)).toBeVisible()
    await expect(app.page.getByText("t1")).toBeVisible()
    await expect(
      app.page
        .getByRole("heading", { name: "t1" })
        .locator("xpath=../../..")
        .locator("dd")
        .first()
    ).toContainText(/\d+(\.\d+)? km/)
  })

  test("bounds public profile cards and pages through a large library", async ({
    app,
    login,
    request,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(50)
    await app.waitForImportToSettle()
    await app.syncNow()

    const token = await readSessionToken(app.page)
    const serverActivities = await serverState(app.page)
    const publish = await request.patch(`${API_URL}/api/activities/metadata`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        updates: serverActivities.activities.map(({ contentHash }) => ({
          contentHash,
          isPublic: true,
        })),
      },
    })
    expect(publish.ok()).toBe(true)

    const firstPageResponse = app.page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/public/users/${login}/activities?page=1`) &&
        response.request().method() === "GET"
    )
    await app.page.goto(PUBLIC_PROFILE_URL(login))
    const firstPage = (await (await firstPageResponse).json()) as {
      activities: unknown[]
      totalCount: number
    }
    expect(firstPage.totalCount).toBe(50)
    expect(firstPage.activities).toHaveLength(48)
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(48)

    const secondPageResponse = app.page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/public/users/${login}/activities?page=2`) &&
        response.request().method() === "GET"
    )
    await app.page.getByRole("button", { name: "Next page" }).click()
    await expect(app.page).toHaveURL(new RegExp(`/u/${login}\\?page=2$`))
    expect(
      ((await (await secondPageResponse).json()) as { activities: unknown[] })
        .activities
    ).toHaveLength(2)
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(2)
    await expect(
      app.page.getByRole("heading", { name: "Public activities" })
    ).toBeFocused()
  })
})
