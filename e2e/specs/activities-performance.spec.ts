import { expect, test } from "@playwright/test"

import {
  makePerformanceActivities,
  readPerformanceMetrics,
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
            await page
              .getByRole("button", { name: "Load more activities" })
              .click()
            await expect(cards).toHaveCount(Math.min(96, count))
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

    const loadMore = page.getByRole("button", { name: "Load more activities" })
    await loadMore.click()
    await expect(loadMore).toBeFocused()
    await expect(cards).toHaveCount(96)

    const renderedIds = await cards.evaluateAll((nodes) =>
      nodes.map((node) =>
        node.getAttribute("data-testid")!.slice("activity-card-".length)
      )
    )
    const expectedIds = [...activities]
      .sort((a, b) => b.stats.distanceKm - a.stats.distanceKm)
      .slice(0, 96)
      .map((activity) => activity.id)
    expect(renderedIds).toEqual(expectedIds)
    await expect(
      page.getByRole("checkbox", {
        name: `Select activity ${selectedActivity.name}`,
      })
    ).toBeChecked()
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
})
