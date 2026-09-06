import {
  test,
  expect,
  readSessionToken,
  type ServerState,
} from "../fixtures/app"
import type { APIRequestContext, Page } from "@playwright/test"
import { API_URL } from "../fixtures/ports"

const PUBLIC_PROFILE_URL = (handle: string) => `/u/${handle}`
const PUBLIC_ACTIVITIES_URL = (handle: string) => `/u/${handle}/activities`

async function publishActivities(
  request: APIRequestContext,
  page: Page,
  activities: ServerState["activities"],
  include: (activity: ServerState["activities"][number]) => boolean = () => true
) {
  const token = await readSessionToken(page)
  const response = await request.patch(`${API_URL}/api/activities/metadata`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      updates: activities.filter(include).map(({ contentHash }) => ({
        contentHash,
        isPublic: true,
      })),
    },
  })
  expect(response.ok()).toBe(true)
}

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

  test("private activities never appear on public activity pages", async ({
    app,
    login,
    request,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(2)
    await app.waitForImportToSettle()
    await app.syncNow()

    const { activities } = await serverState(app.page)
    await publishActivities(
      request,
      app.page,
      activities,
      (activity) => activity.name === "t1.gpx"
    )

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(app.page.locator("h1").getByText(login)).toBeVisible()
    await expect(app.page.getByText("t1")).toBeVisible()
    await expect(app.page.getByText("t2")).toHaveCount(0)

    await app.page.goto(PUBLIC_ACTIVITIES_URL(login))
    await expect(app.page.getByText("t1")).toBeVisible()
    await expect(app.page.getByText("t2")).toHaveCount(0)
    await expect(
      app.page.getByText("Showing 1–1 of 1 public activities")
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

  test("bounds the profile preview at four cards and requests no page", async ({
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

    const { activities } = await serverState(app.page)
    await publishActivities(request, app.page, activities)

    const activityRequests: string[] = []
    const recordActivityRequest = (request: { url(): string }) => {
      if (request.url().includes(`/api/public/users/${login}/activities`)) {
        activityRequests.push(request.url())
      }
    }
    app.page.on("request", recordActivityRequest)
    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(4)
    await expect(
      app.page.getByRole("link", { name: "View all activities" })
    ).toBeVisible()
    app.page.off("request", recordActivityRequest)

    expect(activityRequests).toEqual([])
  })

  test("does not show a view-all link for four or fewer activities", async ({
    app,
    login,
    request,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(4)
    await app.waitForImportToSettle()
    await app.syncNow()

    const { activities } = await serverState(app.page)
    await publishActivities(request, app.page, activities)

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(4)
    await expect(
      app.page.getByRole("link", { name: "View all activities" })
    ).toHaveCount(0)
  })

  test("opens the full activity page from a larger preview", async ({
    app,
    login,
    request,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(5)
    await app.waitForImportToSettle()
    await app.syncNow()

    const { activities } = await serverState(app.page)
    await publishActivities(request, app.page, activities)

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await app.page.getByRole("link", { name: "View all activities" }).click()
    await expect(app.page).toHaveURL(new RegExp(`/u/${login}/activities$`))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(5)
  })

  test("paginates the complete public library in 48-card pages", async ({
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

    const { activities } = await serverState(app.page)
    await publishActivities(request, app.page, activities)

    await app.page.goto(PUBLIC_ACTIVITIES_URL(login))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(48)
    await expect(
      app.page.getByText("Showing 1–48 of 50 public activities")
    ).toBeVisible()

    await app.page.getByRole("button", { name: "Next page" }).click()
    await expect(app.page).toHaveURL(
      new RegExp(`/u/${login}/activities\\?page=2$`)
    )
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(2)
    await expect(
      app.page.getByText("Showing 49–50 of 50 public activities")
    ).toBeVisible()
  })

  test("shows activity management only to the profile owner", async ({
    app,
    login,
    secondDevice,
  }) => {
    await app.goto()
    await app.signIn()

    await app.page.goto(PUBLIC_ACTIVITIES_URL(login))
    await expect(
      app.page.getByRole("link", { name: "Manage activities" })
    ).toHaveAttribute("href", "/activities")

    const visitor = await secondDevice(login)
    await visitor.page.goto(PUBLIC_ACTIVITIES_URL(login))
    await expect(
      visitor.page.getByRole("link", { name: "Manage activities" })
    ).toHaveCount(0)
  })

  test("hiding an activity refreshes the preview and clamps the full page", async ({
    app,
    login,
    request,
    serverState,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(49)
    await app.waitForImportToSettle()
    await app.syncNow()

    const { activities } = await serverState(app.page)
    await publishActivities(request, app.page, activities)

    await app.page.goto(`${PUBLIC_ACTIVITIES_URL(login)}?page=2`)
    const lastCard = app.page
      .locator('[data-testid^="activity-card-"]')
      .filter({ hasText: "t1" })
    await expect(lastCard).toHaveCount(1)
    await lastCard
      .getByRole("button", { name: "Activity actions for t1" })
      .click()
    await app.page.getByRole("menuitem", { name: "Hide from profile" }).click()

    await expect(app.page).toHaveURL(new RegExp(`/u/${login}/activities$`))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(48)
    await expect(
      app.page.getByText("Showing 1–48 of 48 public activities")
    ).toBeVisible()

    await app.page.goto(PUBLIC_PROFILE_URL(login))
    await expect(
      app.page.locator('[data-testid^="activity-card-"]')
    ).toHaveCount(4)
    await expect(app.page.getByText("t1")).toHaveCount(0)
  })
})
