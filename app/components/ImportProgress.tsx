import { useEffect } from "react"
import { UploadSimpleIcon } from "@phosphor-icons/react"
import {
  describeImportStage,
  dismissImportStatus,
  getImportStageProgress,
  useImportStatus,
} from "~/lib/activities/import/status"
import type { ImportStatus } from "~/lib/activities/import/status"

const IMPORT_TERMINAL_HOLD_MS = 2_000

function describeImportHeading(status: ImportStatus): string {
  if (status.phase === "running") {
    return `Preparing activities · ${status.completedFiles} of ${status.totalFiles} prepared`
  }

  const fileNoun = status.totalFiles === 1 ? "file" : "files"
  switch (status.phase) {
    case "complete":
      return `Import complete · ${status.totalFiles} ${fileNoun}`
    case "partial":
      return `Import finished with issues · ${status.totalFiles} ${fileNoun}`
    case "failed":
      return `Import failed · ${status.totalFiles} ${fileNoun}`
    case "cancelled":
      return `Import cancelled · ${status.totalFiles} ${fileNoun}`
    default:
      return "Preparing import"
  }
}

export function ImportProgressIndicator() {
  const status = useImportStatus()

  useEffect(() => {
    if (
      status.phase === "idle" ||
      status.phase === "running" ||
      status.operationId === null ||
      !status.isVisible
    ) {
      return
    }

    const operationId = status.operationId
    const timeoutId = window.setTimeout(() => {
      dismissImportStatus(operationId)
    }, IMPORT_TERMINAL_HOLD_MS)
    return () => window.clearTimeout(timeoutId)
  }, [status.operationId, status.phase, status.isVisible])

  const progress = getImportStageProgress(status)
  if (progress.length === 0) return null

  return (
    <div
      data-testid="import-progress"
      data-phase={status.phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex w-full max-w-[min(28rem,calc(100vw-1.5rem))] items-start gap-2 border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <UploadSimpleIcon
        weight="duotone"
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-2 text-muted-foreground">
        <div className="tabular-nums">{describeImportHeading(status)}</div>
        <div className="space-y-1.5">
          {progress.map((stageProgress) => {
            const stageLabel = describeImportStage(stageProgress.stage)
            return (
              <div
                key={stageProgress.stage}
                data-testid="import-progress-stage"
                data-stage={stageProgress.stage}
                className="space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{stageLabel}</span>
                  <span className="shrink-0 tabular-nums">
                    {stageProgress.settledFiles} of {stageProgress.totalFiles}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={stageLabel}
                  aria-valuemin={0}
                  aria-valuemax={stageProgress.totalFiles}
                  aria-valuenow={stageProgress.settledFiles}
                  aria-valuetext={`${stageProgress.settledFiles} of ${stageProgress.totalFiles} files settled`}
                  className="relative h-1 w-full overflow-hidden bg-muted"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${stageProgress.percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
