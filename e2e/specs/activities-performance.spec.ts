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

          const metrics = await readPerformanceMetrics(page, kind, count)
          console.log(JSON.stringify(metrics))
        })
      }
    }
  }
})
