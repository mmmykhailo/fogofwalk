import { test, expect } from "../fixtures/app"
import { API_URL } from "../fixtures/ports"
import type { Page } from "@playwright/test"

async function chooseOption(
  page: Page,
  triggerName: string,
  optionName: string
) {
  await page.getByRole("combobox", { name: triggerName }).click()
  await page.getByRole("option", { name: optionName, exact: true }).click()
}

test.describe("activities bulk settings", () => {
  test("selects, cancels, confirms, persists, and syncs bulk edits", async ({
    app,
  }) => {
    await app.goto()
    await app.signIn()
    await app.importActivities(3)
    await app.waitForImportToSettle()
    await app.syncNow()

    await app.page.goto("/activities")
    await expect(
      app.page.getByRole("heading", { name: "My activities" })
    ).toBeVisible()

    const sort = app.page.getByRole("combobox", { name: "Sort by" })
    await expect(sort).toBeVisible()
    await chooseOption(app.page, "Sort by", "Distance")
    await expect(app.page).toHaveURL(/\/activities\?sort=distance$/)

    const activities = await app.localActivities()
    const first = activities.find((activity) => activity.name === "t1.gpx")!
    const second = activities.find((activity) => activity.name === "t2.gpx")!
    const firstCard = app.page.getByTestId(`activity-card-${first.id}`)
    const secondCard = app.page.getByTestId(`activity-card-${second.id}`)

    await expect(
      app.page.getByRole("checkbox", {
        name: `Select activity ${first.name}`,
      })
    ).toBeVisible()
    await expect(
      app.page.getByRole("combobox", {
        name: `Activity type for ${first.name}`,
      })
    ).toBeVisible()
    await expect(
      app.page.getByRole("combobox", {
        name: `Publicity for ${first.name}`,
      })
    ).toBeVisible()

    await chooseOption(app.page, `Activity type for ${first.name}`, "Cycling")
    await expect(
      firstCard.getByRole("combobox", {
        name: `Activity type for ${first.name}`,
      })
    ).toContainText("Cycling")
    await chooseOption(app.page, `Publicity for ${first.name}`, "Public")
    await expect(
      firstCard.getByRole("combobox", {
        name: `Publicity for ${first.name}`,
      })
    ).toContainText("Public")

    await app.page
      .getByRole("checkbox", { name: `Select activity ${first.name}` })
      .click()
    await app.page
      .getByRole("checkbox", { name: `Select activity ${second.name}` })
      .click()
    await expect(app.page.getByText("Selected 2 activities")).toBeVisible()
    await expect(
      app.page.getByRole("combobox", {
        name: `Activity type for ${first.name}`,
      })
    ).toHaveCount(0)
    await expect(
      app.page.getByRole("combobox", {
        name: `Publicity for ${second.name}`,
      })
    ).toHaveCount(0)

    await expect(
      app.page.getByRole("combobox", {
        name: "Set publicity for selected activities",
      })
    ).toContainText("Mixed publicity")
    await expect(
      app.page.getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    ).toContainText("Multiple types")

    await chooseOption(
      app.page,
      "Set activity type for selected activities",
      "Cycling"
    )
    const typeDialog = app.page.getByRole("dialog", {
      name: "Change 2 activities to Cycling?",
    })
    await expect(typeDialog).toBeVisible()
    await typeDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(typeDialog).toBeHidden()
    await expect(
      app.page.getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    ).toContainText("Multiple types")

    await chooseOption(
      app.page,
      "Set publicity for selected activities",
      "Public"
    )
    const publicityDialog = app.page.getByRole("dialog", {
      name: "Make 2 activities public?",
    })
    await expect(publicityDialog).toBeVisible()
    await app.page.keyboard.press("Escape")
    await expect(publicityDialog).toBeHidden()
    await expect(
      app.page.getByRole("combobox", {
        name: "Set publicity for selected activities",
      })
    ).toContainText("Mixed publicity")

    await chooseOption(
      app.page,
      "Set activity type for selected activities",
      "Cycling"
    )
    await app.page
      .getByRole("dialog", { name: "Change 2 activities to Cycling?" })
      .getByRole("button", { name: "Confirm" })
      .click()
    await expect(app.page.getByText("Selected 2 activities")).toBeVisible()
    await expect(
      app.page.getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    ).toContainText("Cycling")

    await chooseOption(
      app.page,
      "Set publicity for selected activities",
      "Public"
    )
    await app.page
      .getByRole("dialog", { name: "Make 2 activities public?" })
      .getByRole("button", { name: "Confirm" })
      .click()
    await expect(app.page.getByText("Selected 2 activities")).toBeVisible()

    await app.page.getByRole("button", { name: "Clear selection" }).click()
    await expect(
      app.page.getByRole("combobox", { name: "Sort by" })
    ).toBeVisible()
    await expect(
      app.page.getByRole("combobox", {
        name: `Activity type for ${first.name}`,
      })
    ).toContainText("Cycling")
    await expect(
      app.page.getByRole("combobox", {
        name: `Publicity for ${first.name}`,
      })
    ).toContainText("Public")

    await app.page.reload()
    await expect(
      app.page.getByRole("heading", { name: "My activities" })
    ).toBeVisible()
    await expect(
      app.page.getByTestId(`activity-card-${first.id}`).getByRole("combobox", {
        name: `Activity type for ${first.name}`,
      })
    ).toContainText("Cycling")
    await expect(
      app.page.getByTestId(`activity-card-${first.id}`).getByRole("combobox", {
        name: `Publicity for ${first.name}`,
      })
    ).toContainText("Public")

    await expect
      .poll(async () => {
        const response = await app.page.request.get(
          `${API_URL}/api/public/users/${app.login}`
        )
        if (!response.ok()) return null
        const profile = (await response.json()) as {
          activities: {
            name: string
            isPublic: boolean
            activityType?: string
          }[]
        }
        return profile.activities
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "t1.gpx",
            isPublic: true,
            activityType: "cycling",
          }),
          expect.objectContaining({
            name: "t2.gpx",
            isPublic: true,
            activityType: "cycling",
          }),
        ])
      )
  })
})
