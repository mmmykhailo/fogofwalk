import { expect, test } from "../fixtures/app"
import type { Locator, Page } from "@playwright/test"

type TestImportStage =
  | "queued"
  | "reading"
  | "parsing"
  | "validating"
  | "ready"
  | "committing"
  | "committed"
  | "deriving"
  | "complete"

interface TestImportProgressEvent {
  operationId: string
  fileIndex: number
  stage: TestImportStage
  completedFiles: number
  totalFiles: number
}

async function beginImport(
  page: Page,
  operationId: string,
  totalFiles: number
): Promise<void> {
  await page.evaluate(
    async ({ operationId: id, totalFiles: count }) => {
      const moduleUrl = "/app/lib/activities/import/status.ts"
      const importStatus = await import(/* @vite-ignore */ moduleUrl)
      importStatus.beginImport(id, count)
    },
    { operationId, totalFiles }
  )
}

async function reportImportProgress(
  page: Page,
  event: TestImportProgressEvent
): Promise<void> {
  await page.evaluate(async (progressEvent: TestImportProgressEvent) => {
    const moduleUrl = "/app/lib/activities/import/status.ts"
    const importStatus = await import(/* @vite-ignore */ moduleUrl)
    importStatus.reportImportProgress(progressEvent)
  }, event)
}

async function failImport(page: Page, operationId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const moduleUrl = "/app/lib/activities/import/status.ts"
    const importStatus = await import(/* @vite-ignore */ moduleUrl)
    importStatus.failImport(id, new Error("test cleanup"))
  }, operationId)
}

async function setFogSnapshot(page: Page, terminal: boolean): Promise<void> {
  await page.evaluate(async (isTerminal: boolean) => {
    const mapStoreModuleUrl = "/app/lib/mapStore.ts"
    const protocolModuleUrl = "/app/lib/fog/protocol.ts"
    const [{ mapStore, recordFogSnapshot }, protocol] = await Promise.all([
      import(/* @vite-ignore */ mapStoreModuleUrl),
      import(/* @vite-ignore */ protocolModuleUrl),
    ])
    const snapshot = {
      generation: mapStore.runId,
      libraryRevision: mapStore.libraryRevision,
      coverageRevision: mapStore.coverageRevision,
      mode: mapStore.fogMode,
      algorithmVersion: protocol.FOG_ALGORITHM_VERSION,
      partitionSchemeVersion: protocol.FOG_PARTITION_SCHEME_VERSION,
      completeness: isTerminal ? "complete" : "partial",
      geometry: { type: "FeatureCollection", features: [] },
      diagnostics: {
        processed: 0,
        total: 0,
        inputPoints: 0,
        outputPoints: 0,
        featureCount: 0,
        vertexCount: 0,
        warnings: [],
        errors: [],
        degraded: false,
      },
    }
    recordFogSnapshot(snapshot, isTerminal)
  }, terminal)
}

async function expectContained(
  locator: Locator,
  width: number,
  height: number
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
  expect(box.y + box.height).toBeLessThanOrEqual(height)
}

test("[I-038] renders concurrent import stages in stable order and stays contained", async ({
  app,
}) => {
  await app.goto()
  const operationId = `e2e-import-progress-${Date.now()}`
  const viewport = { width: 390, height: 844 }

  try {
    await beginImport(app.page, operationId, 3)
    const progress = app.page.getByTestId("import-progress")
    const stageRows = progress.getByTestId("import-progress-stage")

    await expect(progress).toBeVisible()
    await expect(stageRows).toHaveCount(1)
    await expect(stageRows.first()).toHaveText("Queued · 3 files")
    await expect(progress).toContainText(
      "Preparing activities · 0 of 3 prepared"
    )

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "parsing",
      completedFiles: 0,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "parsing",
      completedFiles: 0,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "validating",
      completedFiles: 0,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "validating",
      completedFiles: 0,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 2,
      stage: "parsing",
      completedFiles: 0,
      totalFiles: 3,
    })

    await expect(stageRows).toHaveCount(2)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["parsing", "validating"])
    await expect(stageRows.nth(0)).toHaveText("Parsing activities · 1 file")
    await expect(stageRows.nth(1)).toHaveText("Validating routes · 2 files")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "ready",
      completedFiles: 1,
      totalFiles: 3,
    })
    await expect(stageRows).toHaveCount(3)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["parsing", "validating", "ready"])
    await expect(stageRows.nth(2)).toHaveText("Waiting to save · 1 file")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "ready",
      completedFiles: 2,
      totalFiles: 3,
    })
    await expect(stageRows).toHaveCount(2)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["parsing", "ready"])
    await expect(stageRows.nth(1)).toHaveText("Waiting to save · 2 files")
    await expect(progress).toContainText(
      "Preparing activities · 2 of 3 prepared"
    )
    await expect(progress).toHaveAttribute("role", "status")
    await expect(progress).toHaveAttribute("aria-live", "polite")
    await expect(progress).toHaveAttribute("aria-atomic", "true")
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => ({
          role: row.getAttribute("role"),
          ariaLive: row.getAttribute("aria-live"),
          ariaAtomic: row.getAttribute("aria-atomic"),
        }))
      )
    ).toEqual([
      { role: null, ariaLive: null, ariaAtomic: null },
      { role: null, ariaLive: null, ariaAtomic: null },
    ])

    await app.page.setViewportSize(viewport)
    await setFogSnapshot(app.page, false)
    const fogProgress = app.page.getByText(/^\d+\/\d+$/).locator("xpath=..")
    const controls = app.page.getByRole("button", { name: "Open controls" })
    await expect(progress).toBeVisible()
    await expect(fogProgress).toBeVisible()
    await expect(controls).toBeVisible()
    await expectContained(progress, viewport.width, viewport.height)
    await expectContained(fogProgress, viewport.width, viewport.height)
    await expectContained(controls, viewport.width, viewport.height)
    await expect(controls).toBeEnabled()
    await controls.click()
    await expect(
      app.page.locator('[data-vaul-drawer][data-state="open"]')
    ).toBeVisible()
    await app.page.keyboard.press("Escape")

    await failImport(app.page, operationId)
    await expect(progress).toBeHidden()
  } finally {
    await app.page.keyboard.press("Escape").catch(() => {})
    await failImport(app.page, operationId).catch(() => {})
    await setFogSnapshot(app.page, true).catch(() => {})
  }
})
