import { UploadSimpleIcon } from "@phosphor-icons/react"
import {
  describeImportStage,
  useImportStatus,
} from "~/lib/activities/import/status"

export function ImportProgressIndicator() {
  const status = useImportStatus()
  if (status.phase !== "running") return null

  const fileNumber = status.fileIndex == null ? null : status.fileIndex + 1
  const progress =
    status.totalFiles > 0
      ? Math.round((status.completedFiles / status.totalFiles) * 100)
      : 0

  return (
    <div
      data-testid="import-progress"
      role="status"
      aria-live="polite"
      className="flex max-w-[min(28rem,calc(100vw-1.5rem))] items-center gap-2 border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <UploadSimpleIcon weight="duotone" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        {describeImportStage(status.stage)}
        {fileNumber != null && status.totalFiles > 0
          ? ` · file ${fileNumber} of ${status.totalFiles}`
          : ""}
      </span>
      <span className="text-muted-foreground tabular-nums">{progress}%</span>
    </div>
  )
}
