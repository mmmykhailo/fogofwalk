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

async function setFogSnapshot(
  page: Page,
  options: { terminal: boolean; processed: number; total: number }
): Promise<void> {
  await page.evaluate(async ({ terminal, processed, total }) => {
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
      completeness: terminal ? "complete" : "partial",
      geometry: { type: "FeatureCollection", features: [] },
      diagnostics: {
        processed,
        total,
        inputPoints: 0,
        outputPoints: 0,
        featureCount: 0,
        vertexCount: 0,
        warnings: [],
        errors: [],
        degraded: false,
      },
    }
    recordFogSnapshot(snapshot, terminal)
  }, options)
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

test("[I-038] renders unified activity progress with accessible bars", async ({
  app,
}) => {
  await app.goto()
  const operationId = `e2e-activity-progress-${Date.now()}`
  const viewport = { width: 390, height: 844 }

  try {
    await beginImport(app.page, operationId, 3)
    const progress = app.page.getByTestId("activity-progress")
    const stageRows = progress.getByTestId("activity-progress-stage")
    const bars = progress.getByRole("progressbar")

    await expect(progress).toBeVisible()
    await expect(stageRows).toHaveCount(1)
    await expect(stageRows.first()).toHaveAttribute("data-stage", "parsing")
    await expect(stageRows.first()).toContainText("Parsing activities")
    await expect(stageRows.first()).toContainText("0 of 3")
    await expect(progress).toHaveAttribute("data-phase", "running")
    await expect(bars).toHaveCount(1)
    await expect(bars.first()).toHaveAttribute("aria-valuemin", "0")
    await expect(bars.first()).toHaveAttribute("aria-valuemax", "3")
    await expect(bars.first()).toHaveAttribute("aria-valuenow", "0")
    await expect(bars.first()).toHaveAttribute("aria-valuetext", "0 of 3 files")

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
      {
        operationId,
        fileIndex: 0,
        stage: "ready" as const,
        completedFiles: 1,
        totalFiles: 3,
      },
      {
        operationId,
        fileIndex: 1,
        stage: "ready" as const,
        completedFiles: 2,
        totalFiles: 3,
      },
    ]) {
      await reportImportProgress(app.page, event)
    }

    await expect(stageRows).toHaveCount(1)
    await expect(stageRows.first()).toContainText("2 of 3")
    await expect(progress).not.toContainText(
      /Queued|Reading files|Validating routes|Waiting to save|Saving activities/
    )

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "committing",
      completedFiles: 2,
      totalFiles: 3,
    })
    await expect(stageRows).toHaveCount(2)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["parsing", "saved"])
    await expect(stageRows.nth(1)).toContainText("Activities saved")
    await expect(stageRows.nth(1)).toContainText("0 of 3")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "committed",
      completedFiles: 2,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 0,
      stage: "committed",
      completedFiles: 2,
      totalFiles: 3,
    })
    await expect(stageRows.nth(1)).toContainText("1 of 3")

    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "committing",
      completedFiles: 2,
      totalFiles: 3,
    })
    await reportImportProgress(app.page, {
      operationId,
      fileIndex: 1,
      stage: "committed",
      completedFiles: 2,
      totalFiles: 3,
    })
    await expect(stageRows.nth(1)).toContainText("2 of 3")

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
        stage: "complete" as const,
        completedFiles: 3,
        totalFiles: 3,
      },
    ]) {
      await reportImportProgress(app.page, event)
    }
    await expect(stageRows.nth(0)).toContainText("3 of 3")
    await expect(stageRows.nth(1)).toContainText("2 of 3")

    await setFogSnapshot(app.page, {
      terminal: false,
      processed: 4,
      total: 8,
    })
    await expect(stageRows).toHaveCount(3)
    expect(
      await stageRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-stage"))
      )
    ).toEqual(["parsing", "saved", "fog"])
    await expect(stageRows.nth(2)).toContainText("Processing fog")
    await expect(stageRows.nth(2)).toContainText("4 of 8")
    await expect(bars).toHaveCount(3)
    await expect(bars.nth(2)).toHaveAttribute(
      "aria-valuetext",
      "4 of 8 activities"
    )
    await expect(progress.locator("[aria-live], [aria-atomic]")).toHaveCount(0)
    await expect(progress).toHaveAttribute("role", "status")
    await expect(progress).toHaveAttribute("aria-live", "polite")
    await expect(progress).toHaveAttribute("aria-atomic", "true")

    await app.page.setViewportSize(viewport)
    const controls = app.page.getByRole("button", { name: "Open controls" })
    await expect(progress).toBeVisible()
    await expect(controls).toBeVisible()
    await expectContained(progress, viewport.width, viewport.height)
    await expectContained(stageRows.nth(2), viewport.width, viewport.height)
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
    await setFogSnapshot(app.page, {
      terminal: true,
      processed: 8,
      total: 8,
    })
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute("data-phase", "complete")
    await expect(progress).not.toContainText(
      /Preparing activities|Import complete|Import failed|Preparing import/
    )
    await expect(stageRows).toHaveCount(3)
    await expect(stageRows.nth(0)).toContainText("3 of 3")
    await expect(stageRows.nth(1)).toContainText("3 of 3")
    await expect(stageRows.nth(2)).toContainText("8 of 8")
    for (const bar of [0, 1]) {
      await expect(bars.nth(bar)).toHaveAttribute("aria-valuemin", "0")
      await expect(bars.nth(bar)).toHaveAttribute("aria-valuemax", "3")
      await expect(bars.nth(bar)).toHaveAttribute("aria-valuenow", "3")
      await expect(bars.nth(bar)).toHaveAttribute(
        "aria-valuetext",
        "3 of 3 files"
      )
    }
    await expect(bars.nth(2)).toHaveAttribute("aria-valuemax", "8")
    await expect(bars.nth(2)).toHaveAttribute("aria-valuenow", "8")
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
    await setFogSnapshot(app.page, {
      terminal: true,
      processed: 0,
      total: 0,
    }).catch(() => {})
  }
})

test("[I-039] starts Fill loops with only a fresh fog progress row", async ({
  app,
}) => {
  await app.goto()
  await app.importActivities(2)
  await app.waitForImportToSettle()
  await app.page.evaluate(async () => {
    const moduleUrl = "/app/lib/activities/import/status.ts"
    const importStatus = await import(/* @vite-ignore */ moduleUrl)
    const status = importStatus.getImportStatus()
    if (status.operationId) {
      importStatus.dismissImportStatus(status.operationId)
    }
  })

  await app.page.evaluate(async () => {
    const moduleUrl = "/app/lib/mapStore.ts"
    const mapStore = await import(/* @vite-ignore */ moduleUrl)
    type Observation = {
      phase: string
      mode: string
      processed: number
      total: number
    }
    const observations: Observation[] = []
    const read = (): Observation => {
      const status = mapStore.getFogStatus()
      return {
        phase: status.phase,
        mode: status.mode,
        processed: status.processed,
        total: status.total,
      }
    }
    observations.push(read())
    const unsubscribe = mapStore.subscribeFogStatus(() => {
      observations.push(read())
    })
    ;(
      window as Window & {
        __activityProgressFogObservation?: {
          observations: Observation[]
          unsubscribe: () => void
        }
      }
    ).__activityProgressFogObservation = { observations, unsubscribe }
  })

  await app.openDrawer()
  await app.drawer.getByRole("switch", { name: "Fill loops" }).click()
  await app.closeDrawer()

  const observations = await app.page.evaluate(() => {
    const pageWindow = window as Window & {
      __activityProgressFogObservation?: {
        observations: {
          phase: string
          mode: string
          processed: number
          total: number
        }[]
        unsubscribe: () => void
      }
    }
    const state = pageWindow.__activityProgressFogObservation
    state?.unsubscribe()
    return state?.observations ?? []
  })
  expect(
    observations.some(
      (observation) =>
        observation.phase === "processing" &&
        observation.mode === "fill" &&
        observation.processed === 0 &&
        observation.total === 2
    )
  ).toBe(true)

  const progress = app.page.getByTestId("activity-progress")
  if (await progress.isVisible().catch(() => false)) {
    const rows = progress.getByTestId("activity-progress-stage")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute("data-stage", "fog")
    await expect(rows.first()).toContainText("Processing fog")
    await expect(rows.first()).toContainText("of 2")
    await expect(progress).not.toContainText("Parsing activities")
    await expect(progress).not.toContainText("Activities saved")
  }

  await expect
    .poll(() => app.fogCacheSummary(), { timeout: 45_000 })
    .toMatchObject({ fogMode: "fill" })
})
