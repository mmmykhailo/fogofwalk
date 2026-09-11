import { describe, expect, test } from "bun:test"
import {
  beginImport,
  completeImport,
  getImportStatus,
  reportImportProgress,
} from "./status"
import type { ImportBatchResult } from "./service"

function result(
  operationId: string,
  statuses: Array<"committed" | "duplicate" | "rejected" | "failed">
): ImportBatchResult {
  return {
    operationId,
    cancelled: false,
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
  test("keeps stage progress monotonic and ignores stale operations", () => {
    beginImport("operation-a", 2)
    reportImportProgress({
      operationId: "operation-a",
      fileIndex: 0,
      stage: "parsing",
      completedFiles: 0,
      totalFiles: 2,
    })
    reportImportProgress({
      operationId: "operation-a",
      fileIndex: 0,
      stage: "complete",
      completedFiles: 1,
      totalFiles: 2,
    })
    reportImportProgress({
      operationId: "operation-a",
      fileIndex: 0,
      stage: "parsing",
      completedFiles: 0,
      totalFiles: 2,
    })

    expect(getImportStatus()).toMatchObject({
      phase: "running",
      stage: "complete",
      completedFiles: 1,
      totalFiles: 2,
    })

    beginImport("operation-b", 1)
    reportImportProgress({
      operationId: "operation-a",
      fileIndex: 1,
      stage: "committing",
      completedFiles: 2,
      totalFiles: 2,
    })
    expect(getImportStatus()).toMatchObject({
      operationId: "operation-b",
      stage: "queued",
      completedFiles: 0,
    })
  })

  test("distinguishes complete, partial, and failed terminal outcomes", () => {
    beginImport("complete", 1)
    completeImport(result("complete", ["duplicate"]))
    expect(getImportStatus().phase).toBe("complete")

    beginImport("partial", 2)
    completeImport(result("partial", ["committed", "failed"]))
    expect(getImportStatus().phase).toBe("partial")

    beginImport("failed", 1)
    completeImport(result("failed", ["rejected"]))
    expect(getImportStatus().phase).toBe("failed")
  })
})
