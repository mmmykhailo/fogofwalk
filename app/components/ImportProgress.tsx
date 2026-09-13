import { UploadSimpleIcon } from "@phosphor-icons/react"
import {
  describeImportStage,
  getActiveImportStageSummaries,
  useImportStatus,
} from "~/lib/activities/import/status"

export function ImportProgressIndicator() {
  const status = useImportStatus()
  const summaries = getActiveImportStageSummaries(status)
  if (summaries.length === 0) return null

  return (
    <div
      data-testid="import-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="map-moving-blur-fallback flex max-w-full items-start gap-2 border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <UploadSimpleIcon
        weight="duotone"
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-0.5 text-muted-foreground">
        <div className="tabular-nums">
          Preparing activities · {status.completedFiles} of {status.totalFiles}{" "}
          prepared
        </div>
        {summaries.map((summary) => (
          <div
            key={summary.stage}
            data-testid="import-progress-stage"
            data-stage={summary.stage}
          >
            {describeImportStage(summary.stage)} · {summary.fileCount}{" "}
            {summary.fileCount === 1 ? "file" : "files"}
          </div>
        ))}
      </div>
    </div>
  )
}
