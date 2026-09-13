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

type TestImportTerminalStatus =
  | "committed"
  | "duplicate"
  | "rejected"
  | "cancelled"
  | "failed"

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

async function completeImport(
  page: Page,
  operationId: string,
  statuses: TestImportTerminalStatus[]
): Promise<void> {
  await page.evaluate(
    async ({ operationId: id, statuses: fileStatuses }) => {
      const moduleUrl = "/app/lib/activities/import/status.ts"
      const importStatus = await import(/* @vite-ignore */ moduleUrl)
      const files = fileStatuses.map((status, index) => ({
        index,
        name: `${index}.gpx`,
        stage: "complete" as const,
        status,
        parsedActivityCount: status === "rejected" ? 0 : 1,
        activities:
          status === "committed" || status === "duplicate"
            ? [{ id: `activity-${index}`, status }]
            : [],
        warnings: [],
      }))
      importStatus.completeImport({
        operationId: id,
        files,
        activities: files.flatMap((file) => file.activities),
        cancelled: false,
      })
    },
    { operationId, statuses }
  )
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

test("[I-038] renders persistent import stages with accessible bars", async ({
  app,
}) => {
  await app.goto()
  const operationId = `e2e-import-progress-${Date.now()}`
  const viewport = { width: 390, height: 844 }

  try {
    await beginImport(app.page, operationId, 3)
    const progress = app.page.getByTestId("import-progress")
    const stageRows = progress.getByTestId("import-progress-stage")
    const bars = progress.getByRole("progressbar")

    await expect(progress).toBeVisible()
    await expect(stageRows).toHaveCount(1)
    await expect(stageRows.first()).toContainText("Queued")
    await expect(stageRows.first()).toContainText("0 of 3")
    await expect(progress).toContainText(
      "Preparing activities · 0 of 3 prepared"
    )
    await expect(progress).toHaveAttribute("data-phase", "running")
    await expect(bars).toHaveCount(1)
    await expect(bars.first()).toHaveAttribute("aria-valuemin", "0")
    await expect(bars.first()).toHaveAttribute("aria-valuemax", "3")
    await expect(bars.first()).toHaveAttribute("aria-valuenow", "0")
    await expect(bars.first()).toHaveAttribute(
      "aria-valuetext",
      "0 of 3 files settled"
    )

    for (const event of [
      {
        operationId,
        fileIndex: 0,
        stage: "reading" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 0,
        stage: "parsing" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 1,
        stage: "reading" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 1,
        stage: "parsing" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 0,
        stage: "validating" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 1,
        stage: "validating" as const,
        completedFiles: 0,
        totalFiles: 3,
      },
    ]) {
      await reportImportProgress(app.page, event)
    }

    await expect(stageRows).toHaveCount(4)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["queued", "reading", "parsing", "validating"])
    for (const row of [0, 1, 2]) {
      await expect(stageRows.nth(row)).toContainText("2 of 3")
      await expect(bars.nth(row)).toHaveAttribute("aria-valuenow", "2")
    }
    await expect(stageRows.nth(3)).toContainText("0 of 3")
    await expect(bars.nth(3)).toHaveAttribute("aria-valuenow", "0")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "ready",
      completedFiles: 1,
      totalFiles: 3,
    })
    await expect(stageRows).toHaveCount(5)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["queued", "reading", "parsing", "validating", "ready"])
    await expect(stageRows.nth(0)).toContainText("2 of 3")
    await expect(stageRows.nth(1)).toContainText("2 of 3")
    await expect(stageRows.nth(2)).toContainText("2 of 3")
    await expect(stageRows.nth(3)).toContainText("1 of 3")
    await expect(stageRows.nth(4)).toContainText("0 of 3")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "complete",
      completedFiles: 2,
      totalFiles: 3,
    })
    await expect(stageRows).toHaveCount(5)
    await expect(stageRows.nth(3)).toContainText("2 of 3")
    await expect(stageRows.nth(4)).toContainText("1 of 3")

    for (const event of [
      {
        operationId,
        fileIndex: 2,
        stage: "reading" as const,
        completedFiles: 2,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "parsing" as const,
        completedFiles: 2,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "validating" as const,
        completedFiles: 2,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "ready" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "committing" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
    ]) {
      await reportImportProgress(app.page, event)
    }

    await expect(stageRows).toHaveCount(6)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual([
      "queued",
      "reading",
      "parsing",
      "validating",
      "ready",
      "committing",
    ])
    await expect(stageRows.nth(5)).toContainText("1 of 3")
    await expect(bars.nth(5)).toHaveAttribute("aria-valuenow", "1")

    for (const event of [
      {
        operationId,
        fileIndex: 0,
        stage: "committing" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 0,
        stage: "committed" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "committed" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 0,
        stage: "deriving" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 2,
        stage: "deriving" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
    ]) {
      await reportImportProgress(app.page, event)
    }

    await expect(stageRows).toHaveCount(8)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual([
      "queued",
      "reading",
      "parsing",
      "validating",
      "ready",
      "committing",
      "committed",
      "deriving",
    ])
    await expect(progress).toContainText(
      "Preparing activities · 3 of 3 prepared"
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
    ).toEqual(
      new Array(8).fill({ role: null, ariaLive: null, ariaAtomic: null })
    )
    await expect(progress.locator("[aria-live], [aria-atomic]")).toHaveCount(0)
    expect(
      await bars.evaluateAll((elements) =>
        elements.map((element) => ({
          ariaLive: element.getAttribute("aria-live"),
          ariaAtomic: element.getAttribute("aria-atomic"),
        }))
      )
    ).toEqual(new Array(8).fill({ ariaLive: null, ariaAtomic: null }))

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

    const testTime = new Date("2026-09-13T12:00:00Z")
    await app.page.clock.install({ time: testTime })
    await app.page.clock.pauseAt(testTime)
    await completeImport(app.page, operationId, [
      "committed",
      "duplicate",
      "committed",
    ])
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute("data-phase", "complete")
    await expect(progress).toContainText("Import complete · 3 files")
    await expect(stageRows).toHaveCount(8)
    for (let index = 0; index < 8; index++) {
      await expect(stageRows.nth(index)).toContainText("3 of 3")
      await expect(bars.nth(index)).toHaveAttribute("aria-valuemin", "0")
      await expect(bars.nth(index)).toHaveAttribute("aria-valuemax", "3")
      await expect(bars.nth(index)).toHaveAttribute("aria-valuenow", "3")
      await expect(bars.nth(index)).toHaveAttribute(
        "aria-valuetext",
        "3 of 3 files settled"
      )
    }
    await expectContained(progress, viewport.width, viewport.height)

    await app.page.clock.fastForward(1_999)
    await expect(progress).toBeVisible()
    await app.page.clock.fastForward(1)
    await expect(progress).toBeHidden()

    const oldOperationId = `${operationId}-old`
    const newOperationId = `${operationId}-new`
    await beginImport(app.page, oldOperationId, 1)
    await completeImport(app.page, oldOperationId, ["committed"])
    await expect(progress).toBeVisible()
    await app.page.clock.fastForward(1_000)
    await beginImport(app.page, newOperationId, 1)
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute("data-phase", "running")
    await app.page.clock.fastForward(1_000)
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute("data-phase", "running")

    await failImport(app.page, newOperationId)
    await app.page.clock.fastForward(2_000)
    await expect(progress).toBeHidden()
  } finally {
    await app.page.keyboard.press("Escape").catch(() => {})
    await failImport(app.page, operationId).catch(() => {})
    await setFogSnapshot(app.page, true).catch(() => {})
  }
})
