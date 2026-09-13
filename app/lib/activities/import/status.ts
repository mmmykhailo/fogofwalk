import { useSyncExternalStore } from "react"
import type {
  ImportBatchResult,
  ImportProgressEvent,
  ImportStage,
} from "./service"

export const IMPORT_STAGE_ORDER = [
  "queued",
  "reading",
  "parsing",
  "validating",
  "ready",
  "committing",
  "committed",
  "deriving",
  "complete",
] as const satisfies readonly ImportStage[]

const IMPORT_STAGE_RANK = new Map<ImportStage, number>(
  IMPORT_STAGE_ORDER.map((stage, index) => [stage, index])
)

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
  completedFiles: number
  totalFiles: number
  fileStages: Record<number, ImportStage>
  result: ImportBatchResult | null
  error: string | null
}

export interface ImportStageSummary {
  stage: Exclude<ImportStage, "complete">
  fileCount: number
  fileIndexes: number[]
}

const listeners = new Set<() => void>()

let status: ImportStatus = {
  phase: "idle",
  operationId: null,
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

export function getActiveImportStageSummaries(
  currentStatus: ImportStatus
): ImportStageSummary[] {
  if (currentStatus.phase !== "running") return []

  const grouped = new Map<Exclude<ImportStage, "complete">, number[]>()
  for (const [fileIndex, stage] of Object.entries(currentStatus.fileStages)) {
    if (stage === "complete") continue
    const indexes = grouped.get(stage) ?? []
    indexes.push(Number(fileIndex))
    grouped.set(stage, indexes)
  }

  return Array.from(grouped.entries())
    .map(([stage, fileIndexes]) => {
      fileIndexes.sort((first, second) => first - second)
      return {
        stage,
        fileCount: fileIndexes.length,
        fileIndexes,
      }
    })
    .sort((first, second) => stageRank(first.stage) - stageRank(second.stage))
}

export function beginImport(operationId: string, totalFiles: number): void {
  status = {
    phase: "running",
    operationId,
    completedFiles: 0,
    totalFiles,
    fileStages: Object.fromEntries(
      Array.from({ length: totalFiles }, (_, index) => [index, "queued"])
    ) as Record<number, ImportStage>,
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
  return IMPORT_STAGE_RANK.get(stage) ?? -1
}

export function failImport(operationId: string, error: unknown): void {
  if (status.operationId !== operationId) return
  status = {
    ...status,
    phase: "failed",
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
    case "ready":
      return "Waiting to save"
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
