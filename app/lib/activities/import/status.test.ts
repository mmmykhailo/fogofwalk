import { describe, expect, test } from "bun:test"
import {
  beginImport,
  completeImport,
  dismissImportStatus,
  describeImportStage,
  failImport,
  getImportStageProgress,
  getImportStatus,
  IMPORT_STAGE_ORDER,
  reportImportProgress,
} from "./status"
import type { ImportBatchResult, ImportStage } from "./service"

function progress(
  operationId: string,
  fileIndex: number,
  stage: ImportStage,
  completedFiles: number,
  totalFiles: number
) {
  reportImportProgress({
    operationId,
    fileIndex,
    stage,
    completedFiles,
    totalFiles,
  })
}

function result(
  operationId: string,
  statuses: Array<"committed" | "duplicate" | "rejected" | "failed">,
  cancelled = false
): ImportBatchResult {
  return {
    operationId,
    cancelled,
    files: statuses.map((status, index) => ({
      index,
      name: `${index}.gpx`,
      stage: "complete",
      status,
      parsedActivityCount: status === "rejected" ? 0 : 1,
      activities:
        status === "duplicate" || status === "committed"
          ? [{ id: `activity-${index}`, status }]
          : [],
      warnings: [],
    })),
    activities: statuses.map((status, index) => ({
      id: `activity-${index}`,
      status,
    })),
  }
}

describe("import status", () => {
  test("initializes queued progress and hides empty imports", () => {
    beginImport("initial", 3)

    expect(getImportStatus()).toMatchObject({
      phase: "running",
      operationId: "initial",
      completedFiles: 0,
      totalFiles: 3,
      fileStages: { 0: "queued", 1: "queued", 2: "queued" },
      reachedStages: { queued: true },
      isVisible: true,
    })
    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 0, totalFiles: 3, percentage: 0 },
    ])

    beginImport("empty", 0)

    expect(getImportStatus()).toMatchObject({
      phase: "running",
      operationId: "empty",
      totalFiles: 0,
      fileStages: {},
      reachedStages: {},
      isVisible: false,
    })
    expect(getImportStageProgress(getImportStatus())).toEqual([])
  })

  test("keeps reached rows and counts settled files cumulatively", () => {
    beginImport("persistent", 3)
    progress("persistent", 0, "reading", 0, 3)
    progress("persistent", 0, "parsing", 0, 3)
    progress("persistent", 0, "validating", 0, 3)
    progress("persistent", 1, "reading", 0, 3)
    progress("persistent", 1, "parsing", 0, 3)

    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 2, totalFiles: 3, percentage: 67 },
      { stage: "reading", settledFiles: 2, totalFiles: 3, percentage: 67 },
      { stage: "parsing", settledFiles: 1, totalFiles: 3, percentage: 33 },
      { stage: "validating", settledFiles: 0, totalFiles: 3, percentage: 0 },
    ])

    progress("persistent", 0, "ready", 1, 3)

    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 2, totalFiles: 3, percentage: 67 },
      { stage: "reading", settledFiles: 2, totalFiles: 3, percentage: 67 },
      { stage: "parsing", settledFiles: 1, totalFiles: 3, percentage: 33 },
      { stage: "validating", settledFiles: 1, totalFiles: 3, percentage: 33 },
      { stage: "ready", settledFiles: 0, totalFiles: 3, percentage: 0 },
    ])
    expect(getImportStatus().reachedStages).toEqual({
      queued: true,
      reading: true,
      parsing: true,
      validating: true,
      ready: true,
    })
  })

  test("settles skipped and failed files for later stages", () => {
    beginImport("skipped", 2)
    progress("skipped", 0, "parsing", 0, 2)
    progress("skipped", 0, "complete", 1, 2)
    progress("skipped", 1, "committing", 1, 2)

    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 2, totalFiles: 2, percentage: 100 },
      { stage: "parsing", settledFiles: 2, totalFiles: 2, percentage: 100 },
      {
        stage: "committing",
        settledFiles: 1,
        totalFiles: 2,
        percentage: 50,
      },
    ])

    progress("skipped", 1, "committed", 1, 2)
    expect(getImportStageProgress(getImportStatus())).toContainEqual({
      stage: "committing",
      settledFiles: 2,
      totalFiles: 2,
      percentage: 100,
    })

    beginImport("cancelled-before-read", 1)
    progress("cancelled-before-read", 0, "complete", 0, 1)
    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 1, totalFiles: 1, percentage: 100 },
    ])
  })

  test("orders rows by lifecycle rather than event order", () => {
    beginImport("ordered", IMPORT_STAGE_ORDER.length - 1)
    const displayStages = IMPORT_STAGE_ORDER.filter(
      (stage): stage is Exclude<ImportStage, "complete"> => stage !== "complete"
    )

    for (const [index, stage] of displayStages.entries()) {
      progress(
        "ordered",
        displayStages.length - index - 1,
        stage,
        0,
        displayStages.length
      )
    }

    expect(
      getImportStageProgress(getImportStatus()).map(({ stage }) => stage)
    ).toEqual(displayStages)
    expect(IMPORT_STAGE_ORDER.indexOf("ready")).toBe(
      IMPORT_STAGE_ORDER.indexOf("validating") + 1
    )
    expect(IMPORT_STAGE_ORDER.indexOf("ready")).toBe(
      IMPORT_STAGE_ORDER.indexOf("committing") - 1
    )
    expect(describeImportStage("ready")).toBe("Waiting to save")
  })

  test("ignores backward events without changing the status snapshot", () => {
    beginImport("monotonic", 2)
    progress("monotonic", 0, "validating", 0, 2)
    progress("monotonic", 1, "parsing", 0, 2)
    const snapshot = getImportStatus()
    const progressSnapshot = getImportStageProgress(snapshot)

    progress("monotonic", 0, "parsing", 0, 2)

    expect(getImportStatus()).toBe(snapshot)
    expect(getImportStageProgress(getImportStatus())).toEqual(progressSnapshot)
  })

  test("retains the maximum prepared count and immutable denominator", () => {
    beginImport("operation-a", 2)
    progress("operation-a", 0, "parsing", 1, 2)
    progress("operation-a", 1, "parsing", 0, 2)
    progress("operation-a", 0, "complete", 0, 99)
    expect(getImportStatus().completedFiles).toBe(1)
    expect(getImportStatus().totalFiles).toBe(2)
    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 2, totalFiles: 2, percentage: 100 },
      { stage: "parsing", settledFiles: 1, totalFiles: 2, percentage: 50 },
    ])

    progress("operation-a", 1, "parsing", 99, 99)
    expect(getImportStatus().completedFiles).toBe(99)
    expect(
      getImportStageProgress(getImportStatus()).every(
        (row) => row.totalFiles === 2
      )
    ).toBe(true)
  })

  test("ignores stale operations and does not duplicate same-stage history", () => {
    beginImport("operation-a", 2)
    progress("operation-a", 0, "parsing", 0, 2)
    const reachedStages = getImportStatus().reachedStages
    progress("operation-a", 0, "parsing", 1, 2)
    expect(getImportStatus().completedFiles).toBe(1)
    expect(getImportStatus().reachedStages).toBe(reachedStages)

    beginImport("operation-b", 1)
    progress("operation-a", 0, "committing", 2, 2)

    expect(getImportStatus()).toMatchObject({
      operationId: "operation-b",
      phase: "running",
      completedFiles: 0,
      totalFiles: 1,
      fileStages: { 0: "queued" },
      reachedStages: { queued: true },
      isVisible: true,
    })
  })

  test("preserves reached rows and classifies terminal results", () => {
    beginImport("complete", 1)
    progress("complete", 0, "parsing", 0, 1)
    completeImport(result("complete", ["duplicate"]))
    expect(getImportStatus()).toMatchObject({
      phase: "complete",
      isVisible: true,
      fileStages: { 0: "complete" },
    })
    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 1, totalFiles: 1, percentage: 100 },
      { stage: "parsing", settledFiles: 1, totalFiles: 1, percentage: 100 },
    ])

    beginImport("partial", 2)
    completeImport(result("partial", ["committed", "failed"]))
    expect(getImportStatus().phase).toBe("partial")

    beginImport("failed", 1)
    completeImport(result("failed", ["rejected"]))
    expect(getImportStatus().phase).toBe("failed")

    beginImport("cancelled", 1)
    completeImport(result("cancelled", ["rejected"], true))
    expect(getImportStatus().phase).toBe("cancelled")

    beginImport("runtime-failure", 2)
    progress("runtime-failure", 0, "parsing", 0, 2)
    failImport("runtime-failure", new Error("test cleanup"))
    expect(getImportStatus()).toMatchObject({
      phase: "failed",
      fileStages: { 0: "complete", 1: "complete" },
      isVisible: true,
    })
    expect(getImportStageProgress(getImportStatus())).toEqual([
      { stage: "queued", settledFiles: 2, totalFiles: 2, percentage: 100 },
      { stage: "parsing", settledFiles: 2, totalFiles: 2, percentage: 100 },
    ])
  })

  test("dismisses only the matching visible terminal operation", () => {
    beginImport("running", 1)
    const runningSnapshot = getImportStatus()
    dismissImportStatus("running")
    expect(getImportStatus()).toBe(runningSnapshot)

    completeImport(result("running", ["committed"]))
    const terminalSnapshot = getImportStatus()
    const terminalResult = terminalSnapshot.result
    dismissImportStatus("stale")
    expect(getImportStatus()).toBe(terminalSnapshot)

    dismissImportStatus("running")
    expect(getImportStatus()).toMatchObject({
      phase: "complete",
      operationId: "running",
      isVisible: false,
      result: terminalResult,
    })
    const hiddenSnapshot = getImportStatus()
    dismissImportStatus("running")
    expect(getImportStatus()).toBe(hiddenSnapshot)
  })

  test("an old dismissal cannot hide a replacement operation", () => {
    beginImport("old", 1)
    completeImport(result("old", ["committed"]))
    beginImport("new", 1)

    dismissImportStatus("old")

    expect(getImportStatus()).toMatchObject({
      operationId: "new",
      phase: "running",
      isVisible: true,
      reachedStages: { queued: true },
    })
  })
})
