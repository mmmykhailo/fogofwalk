import { useSyncExternalStore } from "react"
import type {
  ImportBatchResult,
  ImportProgressEvent,
  ImportStage,
} from "./service"

const IMPORT_STAGE_ORDER = [
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
  isSaveStageVisible: boolean
  savedFileIndexes: Readonly<Record<number, true>>
  isVisible: boolean
  result: ImportBatchResult | null
  error: string | null
}

export interface ImportProgressSnapshot {
  completedFiles: number
  savedFiles: number
  totalFiles: number
  isSaveStageVisible: boolean
}

const listeners = new Set<() => void>()

let status: ImportStatus = {
  phase: "idle",
  operationId: null,
  completedFiles: 0,
  totalFiles: 0,
  fileStages: {},
  isSaveStageVisible: false,
  savedFileIndexes: Object.freeze({}),
  isVisible: false,
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

export function getImportProgressSnapshot(
  currentStatus: ImportStatus
): ImportProgressSnapshot | null {
  if (!currentStatus.isVisible || currentStatus.totalFiles <= 0) return null

  const totalFiles = currentStatus.totalFiles
  const completedFiles = Math.min(
    totalFiles,
    Math.max(0, currentStatus.completedFiles)
  )
  const savedFiles = Object.keys(currentStatus.savedFileIndexes).filter(
    (fileIndex) => {
      const index = Number(fileIndex)
      return Number.isInteger(index) && index >= 0 && index < totalFiles
    }
  ).length

  return {
    completedFiles,
    savedFiles: Math.min(totalFiles, Math.max(0, savedFiles)),
    totalFiles,
    isSaveStageVisible: currentStatus.isSaveStageVisible,
  }
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
    isSaveStageVisible: false,
    savedFileIndexes: Object.freeze({}),
    isVisible: totalFiles > 0,
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
  const isSaveStageVisible =
    status.isSaveStageVisible ||
    (stageRank(event.stage) >= stageRank("committing") &&
      event.stage !== "complete")
  const savedFileIndexes =
    event.stage === "committed"
      ? Object.freeze({ ...status.savedFileIndexes, [event.fileIndex]: true })
      : status.savedFileIndexes
  status = {
    ...status,
    phase: "running",
    completedFiles: Math.max(status.completedFiles, event.completedFiles),
    fileStages: {
      ...status.fileStages,
      [event.fileIndex]: event.stage,
    },
    isSaveStageVisible,
    savedFileIndexes,
    isVisible: true,
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
  const savedFileIndexes = Object.freeze(
    result.files.reduce<Record<number, true>>(
      (indexes, file) => {
        if (file.status === "committed" || file.status === "duplicate") {
          indexes[file.index] = true
        }
        return indexes
      },
      { ...status.savedFileIndexes }
    )
  )
  status = {
    ...status,
    phase: terminalPhase(result),
    completedFiles: result.files.length,
    fileStages: Object.fromEntries(
      result.files.map((file) => [file.index, file.stage])
    ),
    isSaveStageVisible:
      status.isSaveStageVisible || Object.keys(savedFileIndexes).length > 0,
    savedFileIndexes,
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
  const fileStages = Object.fromEntries(
    Object.keys(status.fileStages).map((fileIndex) => [fileIndex, "complete"])
  ) as Record<number, ImportStage>
  status = {
    ...status,
    phase: "failed",
    completedFiles: Math.max(status.completedFiles, status.totalFiles),
    fileStages,
    error: error instanceof Error ? error.message : String(error),
  }
  notify()
}

export function dismissImportStatus(operationId: string): void {
  if (
    status.operationId !== operationId ||
    status.phase === "idle" ||
    status.phase === "running" ||
    !status.isVisible
  ) {
    return
  }
  status = {
    ...status,
    isVisible: false,
  }
  notify()
}
