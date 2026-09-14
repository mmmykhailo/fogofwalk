import { describe, expect, test } from "bun:test"
import {
  beginImport,
  completeImport,
  dismissImportStatus,
  failImport,
  getImportProgressSnapshot,
  getImportStatus,
  reportImportProgress,
} from "./status"
import type {
  ImportBatchResult,
  ImportStage,
  ImportTerminalStatus,
} from "./service"

function progress(
  operationId: string,
  fileIndex: number,
  stage: ImportStage,
  completedFiles: number,
  totalFiles: number
): void {
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
  statuses: ImportTerminalStatus[],
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
    activities: statuses.flatMap((status, index) =>
      status === "duplicate" || status === "committed"
        ? [{ id: `activity-${index}`, status }]
        : []
    ),
  }
}

describe("import status", () => {
  test("starts parsing progress at zero and hides empty imports", () => {
    beginImport("initial", 3)

    expect(getImportStatus()).toMatchObject({
      phase: "running",
      operationId: "initial",
      completedFiles: 0,
      totalFiles: 3,
      fileStages: { 0: "queued", 1: "queued", 2: "queued" },
      isSaveStageVisible: false,
      savedFileIndexes: {},
      isVisible: true,
    })
    expect(getImportProgressSnapshot(getImportStatus())).toEqual({
      completedFiles: 0,
      savedFiles: 0,
      totalFiles: 3,
      isSaveStageVisible: false,
    })

    beginImport("empty", 0)

    expect(getImportStatus()).toMatchObject({
      phase: "running",
      operationId: "empty",
      totalFiles: 0,
      fileStages: {},
      isSaveStageVisible: false,
      savedFileIndexes: {},
      isVisible: false,
    })
    expect(getImportProgressSnapshot(getImportStatus())).toBeNull()
  })

  test("counts local preparation as parsing progress across concurrent files", () => {
    beginImport("concurrent", 3)
    progress("concurrent", 0, "parsing", 0, 3)
    progress("concurrent", 1, "parsing", 0, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 0,
      savedFiles: 0,
      totalFiles: 3,
    })

    progress("concurrent", 1, "ready", 1, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 1,
      savedFiles: 0,
    })

    progress("concurrent", 0, "complete", 2, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 2,
      savedFiles: 0,
    })
  })

  test("shows the save milestone at committing and records each committed file once", () => {
    beginImport("save", 3)
    progress("save", 0, "ready", 1, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 1,
      savedFiles: 0,
      isSaveStageVisible: false,
    })

    progress("save", 0, "committing", 1, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      savedFiles: 0,
      isSaveStageVisible: true,
    })

    progress("save", 0, "committed", 1, 3)
    const savedSnapshot = getImportStatus()
    expect(getImportProgressSnapshot(savedSnapshot)).toMatchObject({
      savedFiles: 1,
    })

    progress("save", 0, "committed", 1, 3)
    expect(getImportStatus().savedFileIndexes).not.toBe(
      savedSnapshot.savedFileIndexes
    )
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      savedFiles: 1,
    })

    progress("save", 0, "deriving", 1, 3)
    progress("save", 0, "complete", 1, 3)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      savedFiles: 1,
      isSaveStageVisible: true,
    })
  })

  test("rejected and failed files settle parsing without inventing saving", () => {
    beginImport("rejected", 2)
    progress("rejected", 0, "complete", 1, 2)
    progress("rejected", 1, "complete", 2, 2)

    expect(getImportProgressSnapshot(getImportStatus())).toEqual({
      completedFiles: 2,
      savedFiles: 0,
      totalFiles: 2,
      isSaveStageVisible: false,
    })

    completeImport(result("rejected", ["rejected", "failed"]))
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 2,
      savedFiles: 0,
      isSaveStageVisible: false,
    })
  })

  test("reconciles committed and duplicate terminal outcomes", () => {
    beginImport("terminal", 3)
    completeImport(result("terminal", ["committed", "duplicate", "failed"]))

    expect(getImportStatus()).toMatchObject({
      phase: "partial",
      isVisible: true,
      isSaveStageVisible: true,
      savedFileIndexes: { 0: true, 1: true },
    })
    expect(getImportProgressSnapshot(getImportStatus())).toEqual({
      completedFiles: 3,
      savedFiles: 2,
      totalFiles: 3,
      isSaveStageVisible: true,
    })

    beginImport("all-rejected", 2)
    completeImport(result("all-rejected", ["rejected", "failed"]))
    expect(getImportProgressSnapshot(getImportStatus())).toEqual({
      completedFiles: 2,
      savedFiles: 0,
      totalFiles: 2,
      isSaveStageVisible: false,
    })
  })

  test("preserves an attempted save row after a runtime failure", () => {
    beginImport("runtime-failure", 2)
    progress("runtime-failure", 0, "committing", 1, 2)
    failImport("runtime-failure", new Error("test cleanup"))

    expect(getImportStatus()).toMatchObject({
      phase: "failed",
      fileStages: { 0: "complete", 1: "complete" },
      isSaveStageVisible: true,
    })
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 2,
      savedFiles: 0,
      isSaveStageVisible: true,
    })
  })

  test("clamps progress to the immutable selected-file denominator", () => {
    beginImport("bounded", 2)
    progress("bounded", 0, "parsing", 1, 2)
    progress("bounded", 0, "complete", 99, 99)

    expect(getImportStatus().totalFiles).toBe(2)
    expect(getImportProgressSnapshot(getImportStatus())).toMatchObject({
      completedFiles: 2,
      totalFiles: 2,
    })
  })

  test("ignores stale operations and backward events", () => {
    beginImport("monotonic", 2)
    progress("monotonic", 0, "validating", 0, 2)
    const snapshot = getImportStatus()
    progress("monotonic", 0, "parsing", 1, 2)
    expect(getImportStatus()).toBe(snapshot)

    beginImport("replacement", 1)
    progress("monotonic", 0, "committing", 2, 2)
    expect(getImportStatus()).toMatchObject({
      operationId: "replacement",
      completedFiles: 0,
      totalFiles: 1,
      fileStages: { 0: "queued" },
      isSaveStageVisible: false,
      savedFileIndexes: {},
      isVisible: true,
    })
  })

  test("classifies terminal results and dismisses only the matching operation", () => {
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
      isSaveStageVisible: false,
    })
  })
})
