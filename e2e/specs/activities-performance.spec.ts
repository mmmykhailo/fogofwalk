import { expect, test } from "@playwright/test"

import {
  makePerformanceActivities,
  corruptPerformanceSummary,
  readPerformanceCounters,
  readPerformanceMetrics,
  readActivityStorage,
  seedLegacyV3Database,
  seedPerformanceDatabase,
  type PerformanceActivityKind,
} from "../fixtures/performance"

const ACTIVITIES_PAGE_SIZE = 48
const PERFORMANCE_CARD_CAP = ACTIVITIES_PAGE_SIZE
const PERFORMANCE_DOM_FIXED_OVERHEAD = 200
const PERFORMANCE_DOM_ELEMENTS_PER_CARD = 40
const REQUIRED_TIMINGS = [
  "homeLoaderMs",
  "homeIdbLoadMs",
  "loaderMs",
  "idbLoadMs",
  "sortMs",
  "firstGridCommitMs",
  "navigationMs",
] as const

function expectRequiredTimings(
  metrics: Awaited<ReturnType<typeof readPerformanceMetrics>>
) {
  for (const name of REQUIRED_TIMINGS) {
    const value = metrics[name]
    expect(value).not.toBeNull()
    expect(Number.isFinite(value)).toBe(true)
  }
}

test.describe("activities performance fixture", () => {
  test.describe.configure({ mode: "serial" })

  for (const count of [100, 500, 2_000]) {
    for (const kind of ["metadata", "geometry"] as PerformanceActivityKind[]) {
      test(`${kind} ${count} activities`, async ({ page }) => {
        const activities = makePerformanceActivities(count, kind)
        await seedPerformanceDatabase(page, activities, true)

        await page.goto("/activities?sort=date")
        await expect(
          page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
        ).toBeVisible({
          timeout: 60_000,
        })
        const cards = page.locator('[data-testid^="activity-card-"]')
        const expectedCardCount = Math.min(PERFORMANCE_CARD_CAP, count)
        await expect(cards).toHaveCount(expectedCardCount)
        await expect
          .poll(
            async () => (await readPerformanceMetrics(page, kind, count)).sortMs
          )
          .not.toBeNull()
        const metrics = await readPerformanceMetrics(page, kind, count)
        const counters = await readPerformanceCounters(page)
        expectRequiredTimings(metrics)
        expect(metrics.cardCount).toBe(expectedCardCount)
        expect(metrics.gridCommitCount).toBe(1)
        expect(metrics.elementCount).toBeLessThanOrEqual(
          PERFORMANCE_DOM_FIXED_OVERHEAD +
            PERFORMANCE_DOM_ELEMENTS_PER_CARD * expectedCardCount
        )
        expect(metrics.uniqueDistanceMs).toBeNull()
        expect(counters.fullActivityLoads).toBe(0)
        expect(counters.uniqueDistanceWorkerRequests).toBe(0)
        expect(counters.activitySummaryReads).toBeGreaterThanOrEqual(1)
        if (count > ACTIVITIES_PAGE_SIZE) {
          await page.getByRole("button", { name: "Next page" }).click()
          await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
          await expect(page.getByTestId("activities-grid")).toBeFocused()
          await expect(cards).toHaveCount(
            Math.min(PERFORMANCE_CARD_CAP, count - PERFORMANCE_CARD_CAP)
          )
        }

        // Keep every raw diagnostic field in the report; the assertions above
        // intentionally gate only deterministic structure and metric presence.
        console.log(JSON.stringify({ ...metrics, counters }))
      })
    }
  }

  test("repairs stale unique distances on stats, not activities", async ({
    page,
  }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, false)

    await page.goto("/activities?sort=date")
    await expect(
      page.getByTestId(`activity-card-${activities.at(-1)!.id}`)
    ).toBeVisible()
    const activitiesCounters = await readPerformanceCounters(page)
    expect(activitiesCounters.fullActivityLoads).toBe(0)
    expect(activitiesCounters.uniqueDistanceWorkerRequests).toBe(0)
    expect(activitiesCounters.activitySummaryReads).toBeGreaterThanOrEqual(1)

    await page.goto("/stats")
    await expect(
      page.getByText("Unique distance", { exact: true })
    ).toBeVisible()
    const statsCounters = await readPerformanceCounters(page)
    expect(statsCounters.fullActivityLoads).toBe(1)
    expect(statsCounters.uniqueDistanceWorkerRequests).toBe(1)
    expect(statsCounters.activitySummaryReads).toBeGreaterThanOrEqual(1)
    const statsMetrics = await readPerformanceMetrics(page, "metadata", 100)
    expect(statsMetrics.uniqueDistanceMs).not.toBeNull()
  })

  test("keeps global sort order and selection across pages", async ({
    page,
  }) => {
    const activities = makePerformanceActivities(100, "metadata")
    await seedPerformanceDatabase(page, activities, true)
    await page.goto("/activities?sort=distance")

    const cards = page.locator('[data-testid^="activity-card-"]')
    await expect(cards).toHaveCount(ACTIVITIES_PAGE_SIZE)
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
      .slice(ACTIVITIES_PAGE_SIZE, ACTIVITIES_PAGE_SIZE * 2)
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
    await expect(cards).toHaveCount(ACTIVITIES_PAGE_SIZE)
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
    const beforeCounters = await readPerformanceCounters(page)
    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    const after = await page.evaluate(() => ({
      home: performance.getEntriesByName("home:idb-load", "measure").length,
      activities: performance.getEntriesByName("activities:idb-load", "measure")
        .length,
    }))
    expect(after).toEqual(before)
    expect(await readPerformanceCounters(page)).toEqual(beforeCounters)
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
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${activities[99]!.name}`,
      })
    ).toBeChecked()
    await page
      .getByRole("checkbox", {
        name: `Select activity ${activities[99]!.name}`,
      })
      .click()
    await expect(page.getByText("Selected 47 activities")).toBeVisible()
    await expect(page.getByRole("button", { name: "Select all" })).toBeEnabled()
    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 48 activities")).toBeVisible()

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(cards).toHaveCount(48)
    await expect(page.getByText("Selected 48 activities")).toBeVisible()
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${activities[51]!.name}`,
      })
    ).not.toBeChecked()

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
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${activities[0]!.name}`,
      })
    ).not.toBeChecked()

    await page.getByRole("button", { name: "Previous page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    await page.getByRole("button", { name: "Previous page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date$/)
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${activities[99]!.name}`,
      })
    ).not.toBeChecked()
    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 48 activities")).toBeVisible()
    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/\/activities\?sort=date&page=2$/)
    await page.getByRole("button", { name: "Select all" }).click()
    await expect(page.getByText("Selected 96 activities")).toBeVisible()
    await page
      .getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
      .click()
    await page.getByRole("option", { name: "Cycling", exact: true }).click()
    const typeDialog = page.getByRole("dialog", {
      name: "Change 96 activities to Cycling?",
    })
    await typeDialog.getByRole("button", { name: "Confirm" }).click()
    await expect(typeDialog).toBeHidden()
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
    const beforeCounters = await readPerformanceCounters(page)

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
    expect(await readPerformanceCounters(page)).toEqual(beforeCounters)
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
