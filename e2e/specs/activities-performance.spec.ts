import { expect, test } from "@playwright/test"

import {
  makePerformanceActivities,
  corruptPerformanceSummary,
  readPerformanceMetrics,
  readActivityStorage,
  seedLegacyV3Database,
  seedPerformanceDatabase,
  type PerformanceActivityKind,
} from "../fixtures/performance"

test.describe("activities performance fixture", () => {
  test.describe.configure({ mode: "serial" })

  for (const count of [100, 500, 2_000]) {
    for (const kind of ["metadata", "geometry"] as PerformanceActivityKind[]) {
      for (const uniqueDistancesCurrent of [true, false]) {
        test(`${kind} ${count} activities (${uniqueDistancesCurrent ? "current" : "stale"})`, async ({
          page,
        }) => {
          const activities = makePerformanceActivities(count, kind)
          await seedPerformanceDatabase(
            page,
            activities,
            uniqueDistancesCurrent
          )

          await page.goto("/activities?sort=date")
          await expect(
            page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
          ).toBeVisible({
            timeout: 60_000,
          })
          const cards = page.locator('[data-testid^="activity-card-"]')
          await expect(cards).toHaveCount(Math.min(48, count))
          const metrics = await readPerformanceMetrics(page, kind, count)
          if (count > 48) {
            await page.getByRole("button", { name: "Next page" }).click()
            await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
            await expect(page.getByTestId("activities-grid")).toBeFocused()
            await expect(cards).toHaveCount(Math.min(48, count - 48))
          }

          console.log(JSON.stringify(metrics))
        })
      }
    }
  }

  test("keeps global sort order and selection across pages", async ({
    page,
  }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=distance")

    const cards = page.locator('[data-testid^="activity-card-"]')
    await expect(cards).toHaveCount(48)
    const selectedActivity = activities[9]!
    const firstCheckbox = page.getByRole("checkbox", {
      name: `Select activity ${selectedActivity.name}`,
    })
    await firstCheckbox.click()
    await expect(firstCheckbox).toBeChecked()

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=distance&page=2$/)
    await expect(page.getByTestId("activities-grid")).toBeFocused()
    await expect(cards).toHaveCount(48)

    const renderedIds = await cards.evaluateAll((nodes) =>
      nodes.map((node) =>
        node.getAttribute("data-testid")!.slice("activity-card-".length)
      )
    )
    const expectedIds = [...activities]
      .sort((a, b) => b.stats.distanceKm - a.stats.distanceKm)
      .slice(48, 96)
      .map((activity) => activity.id)
    expect(renderedIds).toEqual(expectedIds)
    await page.getByRole("button", { name: "Previous page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=distance$/)
    await expect(page.getByTestId("activities-grid")).toBeFocused()
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${selectedActivity.name}`,
      })
    ).toBeChecked()

    await page.getByRole("button", { name: "Clear selection" }).click()
    await page.getByRole("combobox", { name: "Sort by" }).click()
    await page.getByRole("option", { name: "Speed", exact: true }).click()
    await expect(page).toHaveURL(/\/activities\?sort=speed$/)
    await expect(cards).toHaveCount(48)
  })

  test("paginates a library with URL-restorable page controls", async ({
    page,
  }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=date")

    const cards = page.locator('[data-testid^="activity-card-"]')
    const expectedIds = [...activities].reverse().map((activity) => activity.id)
    await expect(cards).toHaveCount(48)
    await expect(
      page.getByText("Showing 1–48 of 100 activities", { exact: true })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(
      await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid"))
      )
    ).toEqual(expectedIds.slice(0, 48).map((id) => `activity-card-${id}`))

    await page.getByRole("button", { name: "Page 2" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    await expect(page.getByTestId("activities-grid")).toBeFocused()
    await expect(cards).toHaveCount(48)
    await expect(
      page.getByText("Showing 49–96 of 100 activities", { exact: true })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    )

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=3$/)
    await expect(cards).toHaveCount(4)
    await expect(
      page.getByText("Showing 97–100 of 100 activities", { exact: true })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Page 3" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled()
    expect(
      await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid"))
      )
    ).toEqual(expectedIds.slice(96).map((id) => `activity-card-${id}`))

    await page.goBack()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    await expect(cards).toHaveCount(48)
    await page.goForward()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=3$/)
    await expect(cards).toHaveCount(4)
  })

  test("keeps page-only navigation out of storage", async ({ page }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=date")
    await expect(
      page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
    ).toBeVisible()

    const before = await page.evaluate(() => ({
      home: performance.getEntriesByName("home:idb-load", "measure").length,
      activities: performance.getEntriesByName("activities:idb-load", "measure")
        .length,
    }))
    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    const after = await page.evaluate(() => ({
      home: performance.getEntriesByName("home:idb-load", "measure").length,
      activities: performance.getEntriesByName("activities:idb-load", "measure")
        .length,
    }))
    expect(after).toEqual(before)
  })

  test("normalizes malformed and stale page values", async ({ page }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)

    await page.goto("/activities?sort=date&page=not-a-page")
    await expect(
      page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
    ).toBeVisible()
    await expect(page).toHaveURL(/\/activities\?sort=date$/)
    await expect(page.locator('[data-testid^="activity-card-"]')).toHaveCount(
      48
    )

    await page.goto("/activities?sort=date&page=999")
    await expect(
      page.getByTestId(`activity-card-${activities[0]!.id}`)
    ).toBeVisible()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=3$/)
    await expect(page.locator('[data-testid^="activity-card-"]')).toHaveCount(4)
  })

  test("select all stays page-local while bulk updates stay global", async ({
    page,
  }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=date")

    const cards = page.locator('[data-testid^="activity-card-"]')
    const checkboxes = page.getByRole("checkbox")
    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 48 activities")).toBeVisible()
    await expect(checkboxes).toHaveCount(48)
    expect(
      await checkboxes.evaluateAll((items) =>
        items.every((item) => item.getAttribute("aria-checked") === "true")
      )
    ).toBe(true)

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(cards).toHaveCount(48)
    await expect(page.getByText("Selected 48 activities")).toBeVisible()
    expect(
      await checkboxes.evaluateAll((items) =>
        items.every((item) => item.getAttribute("aria-checked") !== "true")
      )
    ).toBe(true)

    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 96 activities")).toBeVisible()

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(cards).toHaveCount(4)
    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 100 activities")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Select all" })
    ).toBeDisabled()

    await page.getByRole("button", { name: "Clear selection" }).click()
    await expect(
      page.getByText("Showing 97–100 of 100 activities")
    ).toBeVisible()
    expect(
      await checkboxes.evaluateAll((items) =>
        items.every((item) => item.getAttribute("aria-checked") !== "true")
      )
    ).toBe(true)

    await page.getByRole("button", { name: "Previous page" }).click()
    await page.getByRole("button", { name: "Previous page" }).click()
    await page.getByRole("button", { name: "Select all" }).click()
    await page.getByRole("button", { name: "Next page" }).click()
    await page.getByRole("button", { name: "Select all" }).click()
    await page
      .getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
      .click()
    await page.getByRole("option", { name: "Cycling", exact: true }).click()
    await page
      .getByRole("dialog", { name: "Change 96 activities to Cycling?" })
      .getByRole("button", { name: "Confirm" })
      .click()
    await expect(page.getByText("Selected 96 activities")).toBeVisible()

    await page.reload()
    await expect(
      page.getByTestId(`activity-card-${activities[51]!.id}`)
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", {
        name: `Activity type for ${activities[51]!.name}`,
      })
    ).toContainText("Cycling")
    await page.goto("/activities?sort=date")
    await expect(
      page.getByTestId(`activity-card-${activities[99]!.id}`)
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", {
        name: `Activity type for ${activities[99]!.name}`,
      })
    ).toContainText("Cycling")
  })

  test("does not reload storage for sort-only navigation", async ({ page }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=date")
    await expect(
      page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
    ).toBeVisible()
    const before = await page.evaluate(() => ({
      home: performance.getEntriesByName("home:idb-load", "measure").length,
      activities: performance.getEntriesByName("activities:idb-load", "measure")
        .length,
    }))

    await page.getByRole("combobox", { name: "Sort by" }).click()
    await page.getByRole("option", { name: "Distance", exact: true }).click()
    await expect(
      page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
    ).toBeVisible()
    await expect(page).toHaveURL(/\/activities\?sort=distance$/)
    const after = await page.evaluate(() => ({
      home: performance.getEntriesByName("home:idb-load", "measure").length,
      activities: performance.getEntriesByName("activities:idb-load", "measure")
        .length,
    }))
    expect(after).toEqual(before)
  })

  test("upgrades a v3 database and derives summaries", async ({ page }) => {
    const activity = makePerformanceActivities(1, "geometry")[0]!
    await seedLegacyV3Database(page, activity)

    await page.goto("/activities")
    await expect(page.getByTestId(`activity-card-${activity.id}`)).toBeVisible()
    await expect
      .poll(() => readActivityStorage(page))
      .toEqual({ version: 4, activityCount: 1, summaryCount: 1 })
  })

  test("recovers a corrupt summary store without hiding activities", async ({
    page,
  }) => {
    const activity = makePerformanceActivities(1, "metadata")[0]!
    await seedPerformanceDatabase(page, [activity], true)
    await corruptPerformanceSummary(page, activity.id)

    await page.goto("/activities")
    await expect(page.getByTestId(`activity-card-${activity.id}`)).toBeVisible()
    await expect
      .poll(() => readActivityStorage(page))
      .toEqual({ version: 4, activityCount: 1, summaryCount: 1 })
  })

  test("creates an empty v4 library without phantom summaries", async ({
    page,
  }) => {
    await seedPerformanceDatabase(page, [], true)
    await page.goto("/activities")
    await expect(
      page.getByText("Import some activities to see them here.")
    ).toBeVisible()
    await expect
      .poll(() => readActivityStorage(page))
      .toEqual({ version: 4, activityCount: 0, summaryCount: 0 })
  })
})
