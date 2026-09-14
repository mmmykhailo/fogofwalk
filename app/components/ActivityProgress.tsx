import { useEffect } from "react"
import {
  dismissImportStatus,
  getImportProgressSnapshot,
  useImportStatus,
} from "~/lib/activities/import/status"
import type { ImportStatus } from "~/lib/activities/import/status"
import { useFogStatus } from "~/lib/mapStore"
import type { FogProjectionStatus } from "~/lib/mapStore"

const IMPORT_TERMINAL_HOLD_MS = 2_000

export type ActivityProgressStage = "parsing" | "saved" | "fog"

export interface ActivityProgressRow {
  stage: ActivityProgressStage
  label: string
  current: number
  maximum: number
  unit: "files" | "activities"
  percentage: number
}

function clampProgress(current: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, current))
}

function progressPercentage(current: number, maximum: number): number {
  if (maximum <= 0) return 0
  return Math.round((clampProgress(current, maximum) / maximum) * 100)
}

function hasNewlyCommittedActivity(status: ImportStatus): boolean {
  return (
    status.result?.activities.some(
      (activity) => activity.status === "committed"
    ) ?? false
  )
}

function isFogVisible(
  importStatus: ImportStatus,
  fogStatus: FogProjectionStatus
): boolean {
  const isActive =
    fogStatus.phase === "processing" || fogStatus.phase === "recovering"
  const isRetainedForImport =
    importStatus.isVisible &&
    importStatus.phase !== "idle" &&
    importStatus.phase !== "running" &&
    hasNewlyCommittedActivity(importStatus)
  return isActive || isRetainedForImport
}

export function getActivityProgressRows(
  importStatus: ImportStatus,
  fogStatus: FogProjectionStatus
): ActivityProgressRow[] {
  const rows: ActivityProgressRow[] = []
  const importProgress = getImportProgressSnapshot(importStatus)

  if (importProgress) {
    rows.push({
      stage: "parsing",
      label: "Parsing activities",
      current: importProgress.completedFiles,
      maximum: importProgress.totalFiles,
      unit: "files",
      percentage: progressPercentage(
        importProgress.completedFiles,
        importProgress.totalFiles
      ),
    })

    if (importProgress.isSaveStageVisible) {
      rows.push({
        stage: "saved",
        label: "Activities saved",
        current: importProgress.savedFiles,
        maximum: importProgress.totalFiles,
        unit: "files",
        percentage: progressPercentage(
          importProgress.savedFiles,
          importProgress.totalFiles
        ),
      })
    }
  }

  if (isFogVisible(importStatus, fogStatus)) {
    const maximum = Math.max(0, fogStatus.total)
    const current = clampProgress(fogStatus.processed, maximum)
    rows.push({
      stage: "fog",
      label: "Processing fog",
      current,
      maximum,
      unit: "activities",
      percentage: progressPercentage(current, maximum),
    })
  }

  return rows
}

export function ActivityProgressIndicator() {
  const importStatus = useImportStatus()
  const fogStatus = useFogStatus()

  useEffect(() => {
    if (
      importStatus.phase === "idle" ||
      importStatus.phase === "running" ||
      importStatus.operationId === null ||
      !importStatus.isVisible
    ) {
      return
    }

    const operationId = importStatus.operationId
    const timeoutId = window.setTimeout(() => {
      dismissImportStatus(operationId)
    }, IMPORT_TERMINAL_HOLD_MS)
    return () => window.clearTimeout(timeoutId)
  }, [importStatus.operationId, importStatus.phase, importStatus.isVisible])

  const rows = getActivityProgressRows(importStatus, fogStatus)
  if (rows.length === 0) return null

  return (
    <div
      data-testid="activity-progress"
      data-phase={importStatus.phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="map-moving-blur-fallback flex w-full max-w-[min(28rem,calc(100vw-1.5rem))] border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <div className="min-w-0 flex-1 space-y-1.5 text-muted-foreground">
        {rows.map((row) => (
          <div
            key={row.stage}
            data-testid="activity-progress-stage"
            data-stage={row.stage}
            className="space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{row.label}</span>
              <span className="shrink-0 tabular-nums">
                {row.current} of {row.maximum}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={row.maximum}
              aria-valuenow={row.current}
              aria-valuetext={`${row.current} of ${row.maximum} ${row.unit}`}
              className="relative h-1 w-full overflow-hidden bg-muted"
            >
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${row.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
