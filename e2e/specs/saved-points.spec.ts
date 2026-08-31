import { test, expect, readSessionToken } from "../fixtures/app"
import { API_URL } from "../fixtures/ports"

const POINT_ID = "b6069503-50e1-48d2-a4d1-4a5f8a7d70db"
const POINT_NAME = "E2E lookout"
const NOW = 1_700_000_000_000

test.describe("saved points", () => {
  test("edits colour and visibility with dropdown controls", async ({
    app,
  }) => {
    await app.goto()
    await app.seedSavedPoint({
      id: POINT_ID,
      name: POINT_NAME,
      description: null,
      lng: 14.42076,
      lat: 50.08804,
      color: "blue",
      isPublic: false,
      createdAt: NOW,
      updatedAt: NOW,
    })

    await app.page.goto(`/map?savedPoint=${POINT_ID}`)
    await app.page.getByRole("button", { name: "Skip for now" }).click()

    const saveChanges = app.page.getByRole("button", {
      name: "Save changes",
    })
    await expect(saveChanges).toBeVisible()

    await app.page.getByRole("combobox", { name: "Saved point colour" }).click()
    await app.page.getByRole("option", { name: "Purple" }).click()

    await app.page
      .getByRole("combobox", { name: "Saved point visibility" })
      .click()
    await app.page.getByRole("option", { name: "Public" }).click()

    await saveChanges.click()
    await expect(saveChanges).toBeHidden()

    await expect
      .poll(async () => {
        const point = (await app.localSavedPoints()).find(
          ({ id }) => id === POINT_ID
        )
        return point && { color: point.color, isPublic: point.isPublic }
      })
      .toEqual({ color: "purple", isPublic: true })
  })

  test("the owner's public saved-point card is entirely an edit link", async ({
    app,
    login,
    request,
  }) => {
    await app.goto()
    await app.signIn()
    const token = await readSessionToken(app.page)
    const response = await request.put(
      `${API_URL}/api/saved-points/${POINT_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          id: POINT_ID,
          name: POINT_NAME,
          description: "A point published by the browser test.",
          lng: 14.42076,
          lat: 50.08804,
          color: "purple",
          isPublic: true,
        },
      }
    )
    expect(response.ok()).toBeTruthy()

    await app.page.goto(`/u/${login}`)
    const link = app.page
      .getByRole("heading", { name: POINT_NAME })
      .locator("xpath=ancestor::a")
    await expect(link).toBeVisible()

    const card = link.locator("..")
    expect(await card.evaluate((element) => element.tagName)).toBe("DIV")
    await expect(link).toHaveAttribute("href", `/map?savedPoint=${POINT_ID}`)

    const [linkBox, cardBox] = await Promise.all([
      link.boundingBox(),
      card.boundingBox(),
    ])
    expect(linkBox).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(linkBox).toEqual(cardBox)
  })
})
