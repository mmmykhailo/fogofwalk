import { useSyncExternalStore } from "react"
import type {
  ImportBatchResult,
  ImportProgressEvent,
  ImportStage,
} from "./service"

export type ImportOperationPhase =
  | "idle"
  | "running"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"

export interface ImportStatus {
  phase: ImportOperationPhase
  operationId: string | null
  stage: ImportStage | null
  fileIndex: number | null
  completedFiles: number
  totalFiles: number
  fileStages: Record<number, ImportStage>
  result: ImportBatchResult | null
  error: string | null
}

const listeners = new Set<() => void>()

let status: ImportStatus = {
  phase: "idle",
  operationId: null,
  stage: null,
  fileIndex: null,
  completedFiles: 0,
  totalFiles: 0,
  fileStages: {},
  result: null,
  error: null,
}

function notify(): void {
  for (const listener of listeners) listener()
}

export function subscribeImportStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getImportStatus(): ImportStatus {
  return status
}

export function useImportStatus(): ImportStatus {
  return useSyncExternalStore(
    subscribeImportStatus,
    getImportStatus,
    getImportStatus
  )
}

export function beginImport(operationId: string, totalFiles: number): void {
  status = {
    phase: "running",
    operationId,
    stage: totalFiles > 0 ? "queued" : null,
    fileIndex: null,
    completedFiles: 0,
    totalFiles,
    fileStages: {},
    result: null,
    error: null,
  }
  notify()
}

export function reportImportProgress(event: ImportProgressEvent): void {
  if (status.operationId !== event.operationId) return
  const previousStage = status.fileStages[event.fileIndex]
  if (previousStage && stageRank(event.stage) < stageRank(previousStage)) {
    return
  }
  status = {
    ...status,
    phase: "running",
    stage: event.stage,
    fileIndex: event.fileIndex,
    completedFiles: Math.max(status.completedFiles, event.completedFiles),
    totalFiles: event.totalFiles,
    fileStages: {
      ...status.fileStages,
      [event.fileIndex]: event.stage,
    },
  }
  notify()
}

function terminalPhase(result: ImportBatchResult): ImportOperationPhase {
  if (result.cancelled) return "cancelled"
  const failedFiles = result.files.filter((file) =>
    ["failed", "rejected", "cancelled"].includes(file.status)
  )
  if (failedFiles.length === 0) return "complete"
  const committedActivities = result.activities.some((activity) =>
    ["committed", "duplicate"].includes(activity.status)
  )
  return committedActivities ? "partial" : "failed"
}

export function completeImport(result: ImportBatchResult): void {
  if (status.operationId !== result.operationId) return
  status = {
    ...status,
    phase: terminalPhase(result),
    stage: result.files.length > 0 ? "complete" : null,
    fileIndex: result.files.length > 0 ? result.files.length - 1 : null,
    completedFiles: result.files.length,
    totalFiles: result.files.length,
    fileStages: Object.fromEntries(
      result.files.map((file) => [file.index, file.stage])
    ),
    result,
    error: null,
  }
  notify()
}

function stageRank(stage: ImportStage): number {
  return [
    "queued",
    "reading",
    "parsing",
    "validating",
    "committing",
    "committed",
    "deriving",
    "complete",
  ].indexOf(stage)
}

export function failImport(operationId: string, error: unknown): void {
  if (status.operationId !== operationId) return
  status = {
    ...status,
    phase: "failed",
    stage: "complete",
    error: error instanceof Error ? error.message : String(error),
  }
  notify()
}

export function describeImportStage(stage: ImportStage | null): string {
  switch (stage) {
    case "queued":
      return "Queued"
    case "reading":
      return "Reading files"
    case "parsing":
      return "Parsing activities"
    case "validating":
      return "Validating routes"
    case "committing":
      return "Saving activities"
    case "committed":
      return "Activities saved"
    case "deriving":
      return "Starting map projections"
    case "complete":
      return "Import complete"
    default:
      return "Preparing import"
  }
}
