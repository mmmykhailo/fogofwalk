import { getImportProgressSnapshot } from "./import/status"
import type { ImportStatus } from "./import/status"
import type { FogProjectionStatus } from "~/lib/mapStore"

export const ACTIVITY_PROGRESS_STAGE_ORDER = [
  "parsing",
  "saved",
  "fog",
] as const

export type ActivityProgressStage =
  (typeof ACTIVITY_PROGRESS_STAGE_ORDER)[number]

export type ActivityProgressLabel =
  | "Parsing activities"
  | "Activities saved"
  | "Processing fog"

export interface ActivityProgressRow {
  stage: ActivityProgressStage
  label: ActivityProgressLabel
  current: number
  maximum: number
  unit: "files" | "activities"
  percentage: number
}

export interface ActivityProgressSession {
  rows: Partial<Record<ActivityProgressStage, ActivityProgressRow>>
  importOperationId: string | null
  fogRequestId: string | null
  fogGeneration: number | null
}

export interface ActivityProgressIdentities {
  importOperationId: string | null
  fogRequestId: string | null
  fogGeneration: number | null
}

export type ActivityProgressObservedRows = Partial<
  Record<ActivityProgressStage, ActivityProgressRow>
>

const ACTIVITY_PROGRESS_LABELS: Record<
  ActivityProgressStage,
  ActivityProgressLabel
> = {
  parsing: "Parsing activities",
  saved: "Activities saved",
  fog: "Processing fog",
}

const ACTIVITY_PROGRESS_UNITS: Record<
  ActivityProgressStage,
  ActivityProgressRow["unit"]
> = {
  parsing: "files",
  saved: "files",
  fog: "activities",
}

export function createActivityProgressSession(): ActivityProgressSession {
  return {
    rows: {},
    importOperationId: null,
    fogRequestId: null,
    fogGeneration: null,
  }
}

export function clampProgress(current: number, maximum: number): number {
  const safeMaximum = Number.isFinite(maximum) ? Math.max(0, maximum) : 0
  const safeCurrent = Number.isFinite(current) ? current : 0
  return Math.min(safeMaximum, Math.max(0, safeCurrent))
}

export function progressPercentage(current: number, maximum: number): number {
  if (maximum <= 0) return 0
  return Math.round((clampProgress(current, maximum) / maximum) * 100)
}

function makeActivityProgressRow(
  stage: ActivityProgressStage,
  current: number,
  maximum: number
): ActivityProgressRow {
  const normalizedMaximum = Number.isFinite(maximum) ? Math.max(0, maximum) : 0
  const normalizedCurrent = clampProgress(current, normalizedMaximum)
  return {
    stage,
    label: ACTIVITY_PROGRESS_LABELS[stage],
    current: normalizedCurrent,
    maximum: normalizedMaximum,
    unit: ACTIVITY_PROGRESS_UNITS[stage],
    percentage: progressPercentage(normalizedCurrent, normalizedMaximum),
  }
}

function normalizeActivityProgressRow(
  row: ActivityProgressRow
): ActivityProgressRow {
  return makeActivityProgressRow(row.stage, row.current, row.maximum)
}

function rowsFromObserved(
  observedRows: ActivityProgressObservedRows | readonly ActivityProgressRow[]
): ActivityProgressObservedRows {
  if (Array.isArray(observedRows)) {
    return observedRows.reduce<ActivityProgressObservedRows>((rows, row) => {
      rows[row.stage] = row
      return rows
    }, {})
  }
  return observedRows
}

export function getActivityProgressIdentities(
  importStatus: ImportStatus,
  fogStatus: FogProjectionStatus
): ActivityProgressIdentities {
  return {
    importOperationId: importStatus.operationId,
    fogRequestId: fogStatus.requestId,
    fogGeneration: fogStatus.generation,
  }
}

function isFogActive(status: FogProjectionStatus): boolean {
  return status.phase === "processing" || status.phase === "recovering"
}

function isCurrentObservedFogRequest(
  fogStatus: FogProjectionStatus,
  session: ActivityProgressSession
): boolean {
  return (
    session.fogRequestId !== null &&
    fogStatus.requestId === session.fogRequestId &&
    fogStatus.generation === session.fogGeneration
  )
}

export function getObservedActivityProgressRows(
  importStatus: ImportStatus,
  fogStatus: FogProjectionStatus,
  session: ActivityProgressSession
): ActivityProgressObservedRows {
  const rows: ActivityProgressObservedRows = {}
  const importProgress = getImportProgressSnapshot(importStatus)

  if (importProgress) {
    rows.parsing = makeActivityProgressRow(
      "parsing",
      importProgress.completedFiles,
      importProgress.totalFiles
    )
    if (importProgress.isSaveStageVisible) {
      rows.saved = makeActivityProgressRow(
        "saved",
        importProgress.savedFiles,
        importProgress.totalFiles
      )
    }
  }

  const shouldObserveFog =
    isFogActive(fogStatus) || isCurrentObservedFogRequest(fogStatus, session)
  if (shouldObserveFog) {
    rows.fog = makeActivityProgressRow(
      "fog",
      fogStatus.processed,
      fogStatus.total
    )
  }

  return rows
}

function sameActivityProgressRow(
  first: ActivityProgressRow | undefined,
  second: ActivityProgressRow | undefined
): boolean {
  return (
    first === second ||
    (first !== undefined &&
      second !== undefined &&
      first.stage === second.stage &&
      first.label === second.label &&
      first.current === second.current &&
      first.maximum === second.maximum &&
      first.unit === second.unit &&
      first.percentage === second.percentage)
  )
}

export function mergeActivityProgressSession(
  session: ActivityProgressSession,
  observedRows: ActivityProgressObservedRows | readonly ActivityProgressRow[],
  identities: ActivityProgressIdentities
): ActivityProgressSession {
  const observed = rowsFromObserved(observedRows)
  const hasImportObservation =
    observed.parsing !== undefined || observed.saved !== undefined
  const hasFogObservation = observed.fog !== undefined
  const isNewImport =
    hasImportObservation &&
    identities.importOperationId !== session.importOperationId
  const isNewFogRequest =
    hasFogObservation &&
    (identities.fogRequestId !== session.fogRequestId ||
      identities.fogGeneration !== session.fogGeneration)
  const nextRows: Partial<Record<ActivityProgressStage, ActivityProgressRow>> =
    {
      ...session.rows,
    }

  if (isNewImport) {
    delete nextRows.parsing
    delete nextRows.saved
  }
  if (isNewFogRequest) delete nextRows.fog

  for (const stage of ACTIVITY_PROGRESS_STAGE_ORDER) {
    const row = observed[stage]
    if (!row) continue
    nextRows[stage] = normalizeActivityProgressRow(row)
  }

  const nextSession: ActivityProgressSession = {
    rows: nextRows,
    importOperationId: hasImportObservation
      ? identities.importOperationId
      : session.importOperationId,
    fogRequestId: hasFogObservation
      ? identities.fogRequestId
      : session.fogRequestId,
    fogGeneration: hasFogObservation
      ? identities.fogGeneration
      : session.fogGeneration,
  }

  const rowsUnchanged = ACTIVITY_PROGRESS_STAGE_ORDER.every((stage) =>
    sameActivityProgressRow(nextRows[stage], session.rows[stage])
  )
  if (
    rowsUnchanged &&
    nextSession.importOperationId === session.importOperationId &&
    nextSession.fogRequestId === session.fogRequestId &&
    nextSession.fogGeneration === session.fogGeneration
  ) {
    return session
  }
  return nextSession
}

export function getActivityProgressRows(
  session: ActivityProgressSession
): ActivityProgressRow[] {
  return ACTIVITY_PROGRESS_STAGE_ORDER.flatMap((stage) => {
    const row = session.rows[stage]
    return row ? [row] : []
  })
}

export function isActivityProgressSessionComplete(
  session: ActivityProgressSession
): boolean {
  const rows = getActivityProgressRows(session)
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.maximum > 0 &&
        clampProgress(row.current, row.maximum) === row.maximum
    )
  )
}

function countSavedFiles(status: ImportStatus): number {
  const totalFiles = Math.max(0, status.totalFiles)
  return Object.keys(status.savedFileIndexes).filter((fileIndex) => {
    const index = Number(fileIndex)
    return Number.isInteger(index) && index >= 0 && index < totalFiles
  }).length
}

export function activityProgressUpdateKey(
  importStatus: ImportStatus,
  fogStatus: FogProjectionStatus
): string {
  const importProgress = getImportProgressSnapshot(importStatus)
  const totalFiles = Number.isFinite(importStatus.totalFiles)
    ? Math.max(0, importStatus.totalFiles)
    : 0
  const completedFiles = clampProgress(
    importProgress?.completedFiles ?? importStatus.completedFiles,
    totalFiles
  )
  const savedFiles = Math.min(
    totalFiles,
    Math.max(0, importProgress?.savedFiles ?? countSavedFiles(importStatus))
  )

  return JSON.stringify([
    importStatus.operationId,
    importStatus.phase,
    importStatus.isVisible,
    completedFiles,
    savedFiles,
    totalFiles,
    importStatus.isSaveStageVisible,
    fogStatus.requestId,
    fogStatus.generation,
    fogStatus.libraryRevision,
    fogStatus.coverageRevision,
    fogStatus.mode,
    fogStatus.phase,
    fogStatus.processed,
    fogStatus.total,
  ])
}
