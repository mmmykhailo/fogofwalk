import { test, expect } from "../fixtures/app"
import { makeDisconnectedGpx } from "../fixtures/gpx"

interface GeometrySource {
  getData?: () => Promise<{
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown }
    }>
  }>
}

interface E2eMap {
  getSource(id: string): unknown
}

declare global {
  interface Window {
    __fogofwalkE2eMap?: E2eMap
    __fogofwalkE2eShareGeometry?: {
      type?: string
      coordinates?: unknown
    }
  }
}

test("[I-037] keeps disconnected paths separate in map and share rendering", async ({
  app,
}) => {
  await app.goto()
  await app.importFiles([makeDisconnectedGpx()])
  await app.waitForImportToSettle()

  const activity = (await app.localActivities()).find((item) =>
    item.name.includes("disconnected")
  )
  if (!activity) throw new Error("disconnected fixture was not imported")

  await app.page.goto(`/map?activity=${encodeURIComponent(activity.id)}`)
  await app.waitUntilReady()

  const mainGeometry = await app.page.evaluate(() => {
    const source = window.__fogofwalkE2eMap?.getSource("activities-source") as
      | GeometrySource
      | undefined
    return source?.getData
      ? source.getData().then((data) => data.features?.[0]?.geometry ?? null)
      : null
  })
  expect(mainGeometry).toMatchObject({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 0],
        [0.01, 0.01],
      ],
      [
        [1, 1],
        [1.01, 1.01],
      ],
    ],
  })

  await app.page.getByRole("button", { name: "Share" }).click()
  const dialog = app.page.getByRole("dialog", { name: "Share activity" })
  await expect(dialog).toBeVisible()
  await expect(app.page.getByText("Rendering map…")).toBeHidden({
    timeout: 30_000,
  })

  const shareGeometry = await app.page.evaluate(() => {
    return window.__fogofwalkE2eShareGeometry ?? null
  })
  expect(shareGeometry).toMatchObject({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 0],
        [0.01, 0.01],
      ],
      [
        [1, 1],
        [1.01, 1.01],
      ],
    ],
  })

  await dialog.getByRole("button", { name: "Dark", exact: true }).click()
  const preview = dialog.getByTestId("share-card-preview")
  await expect(preview).toBeVisible()
  await expect
    .poll(
      () =>
        preview.evaluate((canvas) => {
          const context = canvas.getContext("2d")
          if (!context) return null
          const pixel = context.getImageData(540, 472, 1, 1).data
          return [pixel[0], pixel[1], pixel[2]]
        }),
      { timeout: 15_000 }
    )
    .toEqual([10, 10, 30])
})
