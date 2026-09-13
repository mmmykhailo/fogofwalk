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

export type DisplayImportStage = Exclude<ImportStage, "complete">

export interface ImportStatus {
  phase: ImportOperationPhase
  operationId: string | null
  completedFiles: number
  totalFiles: number
  fileStages: Record<number, ImportStage>
  reachedStages: Partial<Record<DisplayImportStage, true>>
  isVisible: boolean
  result: ImportBatchResult | null
  error: string | null
}

export interface ImportStageProgress {
  stage: DisplayImportStage
  settledFiles: number
  totalFiles: number
  percentage: number
}

const listeners = new Set<() => void>()

let status: ImportStatus = {
  phase: "idle",
  operationId: null,
  completedFiles: 0,
  totalFiles: 0,
  fileStages: {},
  reachedStages: {},
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

export function getImportStageProgress(
  currentStatus: ImportStatus
): ImportStageProgress[] {
  if (!currentStatus.isVisible || currentStatus.totalFiles <= 0) return []

  return IMPORT_STAGE_ORDER.flatMap((stage) => {
    if (stage === "complete" || !currentStatus.reachedStages[stage]) {
      return []
    }

    const settledFiles = Object.values(currentStatus.fileStages).filter(
      (currentStage) => stageRank(currentStage) > stageRank(stage)
    ).length
    const boundedSettledFiles = Math.min(
      currentStatus.totalFiles,
      Math.max(0, settledFiles)
    )
    const percentage = Math.round(
      Math.min(1, Math.max(0, boundedSettledFiles / currentStatus.totalFiles)) *
        100
    )

    return [
      {
        stage,
        settledFiles: boundedSettledFiles,
        totalFiles: currentStatus.totalFiles,
        percentage,
      },
    ]
  })
}

export function beginImport(operationId: string, totalFiles: number): void {
  const reachedStages: Partial<Record<DisplayImportStage, true>> =
    totalFiles > 0 ? { queued: true } : {}
  status = {
    phase: "running",
    operationId,
    completedFiles: 0,
    totalFiles,
    fileStages: Object.fromEntries(
      Array.from({ length: totalFiles }, (_, index) => [index, "queued"])
    ) as Record<number, ImportStage>,
    reachedStages,
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
  const reachedStages =
    event.stage === "complete" || status.reachedStages[event.stage]
      ? status.reachedStages
      : { ...status.reachedStages, [event.stage]: true }
  status = {
    ...status,
    phase: "running",
    completedFiles: Math.max(status.completedFiles, event.completedFiles),
    fileStages: {
      ...status.fileStages,
      [event.fileIndex]: event.stage,
    },
    reachedStages,
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
  status = {
    ...status,
    phase: terminalPhase(result),
    completedFiles: result.files.length,
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
  const fileStages = Object.fromEntries(
    Object.keys(status.fileStages).map((fileIndex) => [fileIndex, "complete"])
  ) as Record<number, ImportStage>
  status = {
    ...status,
    phase: "failed",
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
