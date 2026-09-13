import { describe, expect, test } from "bun:test"
import {
  beginImport,
  completeImport,
  describeImportStage,
  failImport,
  getActiveImportStageSummaries,
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
  test("[I-038] groups concurrent file stages instead of projecting the latest event", () => {
    beginImport("operation-a", 3)
    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([
      { stage: "queued", fileCount: 3, fileIndexes: [0, 1, 2] },
    ])

    progress("operation-a", 0, "parsing", 0, 3)
    progress("operation-a", 1, "parsing", 0, 3)
    progress("operation-a", 0, "validating", 0, 3)
    progress("operation-a", 1, "validating", 0, 3)
    progress("operation-a", 2, "parsing", 0, 3)

    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([
      { stage: "parsing", fileCount: 1, fileIndexes: [2] },
      { stage: "validating", fileCount: 2, fileIndexes: [0, 1] },
    ])
  })

  test("groups indexes, updates stage membership, and sorts each group", () => {
    beginImport("grouped", 4)
    progress("grouped", 3, "validating", 0, 4)
    progress("grouped", 1, "validating", 0, 4)
    progress("grouped", 2, "parsing", 0, 4)
    progress("grouped", 0, "reading", 0, 4)

    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([
      { stage: "reading", fileCount: 1, fileIndexes: [0] },
      { stage: "parsing", fileCount: 1, fileIndexes: [2] },
      { stage: "validating", fileCount: 2, fileIndexes: [1, 3] },
    ])

    beginImport("moving", 2)
    progress("moving", 0, "parsing", 0, 2)
    progress("moving", 1, "parsing", 0, 2)
    progress("moving", 0, "validating", 0, 2)
    progress("moving", 0, "validating", 0, 2)

    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([
      { stage: "parsing", fileCount: 1, fileIndexes: [1] },
      { stage: "validating", fileCount: 1, fileIndexes: [0] },
    ])
  })

  test("orders lifecycle stages independently of cross-file event order", () => {
    beginImport("ordered", IMPORT_STAGE_ORDER.length - 1)
    const activeStages = IMPORT_STAGE_ORDER.filter(
      (stage): stage is Exclude<ImportStage, "complete"> => stage !== "complete"
    )

    for (const [index, stage] of activeStages.entries()) {
      progress(
        "ordered",
        activeStages.length - index - 1,
        stage,
        0,
        activeStages.length
      )
    }

    expect(
      getActiveImportStageSummaries(getImportStatus()).map(({ stage }) => stage)
    ).toEqual(activeStages)
    expect(IMPORT_STAGE_ORDER.indexOf("ready")).toBe(
      IMPORT_STAGE_ORDER.indexOf("validating") + 1
    )
    expect(IMPORT_STAGE_ORDER.indexOf("ready")).toBe(
      IMPORT_STAGE_ORDER.indexOf("committing") - 1
    )
    expect(describeImportStage("ready")).toBe("Waiting to save")
  })

  test("omits terminal files while active siblings remain visible", () => {
    beginImport("terminal", 2)
    progress("terminal", 0, "complete", 1, 2)
    progress("terminal", 1, "validating", 0, 2)

    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([
      { stage: "validating", fileCount: 1, fileIndexes: [1] },
    ])
  })

  test("ignores backward events without changing the status snapshot", () => {
    beginImport("monotonic", 2)
    progress("monotonic", 0, "validating", 0, 2)
    progress("monotonic", 1, "parsing", 0, 2)
    const snapshot = getImportStatus()
    const summaries = getActiveImportStageSummaries(snapshot)

    progress("monotonic", 0, "parsing", 0, 2)

    expect(getImportStatus()).toBe(snapshot)
    expect(getActiveImportStageSummaries(getImportStatus())).toEqual(summaries)
  })

  test("ignores stale operations and retains the maximum prepared count", () => {
    beginImport("operation-a", 2)
    progress("operation-a", 0, "parsing", 1, 2)
    progress("operation-a", 1, "parsing", 0, 2)
    progress("operation-a", 0, "complete", 0, 2)
    expect(getImportStatus().completedFiles).toBe(1)

    beginImport("operation-b", 1)
    progress("operation-a", 0, "committing", 2, 2)

    expect(getImportStatus()).toMatchObject({
      operationId: "operation-b",
      phase: "running",
      completedFiles: 0,
      totalFiles: 1,
      fileStages: { 0: "queued" },
    })
  })

  test("keeps terminal classifications and hides active summaries", () => {
    beginImport("complete", 1)
    completeImport(result("complete", ["duplicate"]))
    expect(getImportStatus().phase).toBe("complete")
    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([])

    beginImport("partial", 2)
    completeImport(result("partial", ["committed", "failed"]))
    expect(getImportStatus().phase).toBe("partial")

    beginImport("failed", 1)
    completeImport(result("failed", ["rejected"]))
    expect(getImportStatus().phase).toBe("failed")

    beginImport("cancelled", 1)
    completeImport(result("cancelled", ["rejected"], true))
    expect(getImportStatus().phase).toBe("cancelled")

    beginImport("runtime-failure", 1)
    progress("runtime-failure", 0, "parsing", 0, 1)
    failImport("runtime-failure", new Error("test cleanup"))
    expect(getImportStatus().phase).toBe("failed")
    expect(getActiveImportStageSummaries(getImportStatus())).toEqual([])
  })
})
