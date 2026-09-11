import { useSyncExternalStore } from "react"
import {
  getFogProcessedCount,
  getFogStatus,
  subscribeFogProgress,
  subscribeFogStatus,
  useFogStatus,
} from "~/lib/mapStore"
import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"

function useFogProcessedCount(): number {
  return useSyncExternalStore(
    subscribeFogProgress,
    getFogProcessedCount,
    getFogProcessedCount
  )
}

export function FogProgressIndicator({
  activityCount,
}: {
  activityCount: number
}) {
  const processedCount = useFogProcessedCount()

  return (
    <div className="flex h-8 items-center gap-2 border border-border bg-background/80 px-2.5 backdrop-blur-md">
      <span className="text-xs text-muted-foreground tabular-nums">
        {processedCount}/{activityCount}
      </span>
      <div className="relative h-1 w-20 overflow-hidden bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300"
          style={{
            width: `${activityCount > 0 ? Math.round((processedCount / activityCount) * 100) : 0}%`,
          }}
        />
      </div>
    </div>
  )
}

export function FogProgressText({ activityCount }: { activityCount: number }) {
  const processedCount = useFogProcessedCount()
  const status = useFogStatus()
  return (
    <>
      {status.phase === "recovering"
        ? "Rebuilding fog…"
        : `Processing ${processedCount} of ${activityCount}…`}
    </>
  )
}

export function FogStatusNotice({ onRetry }: { onRetry: () => void }) {
  const status = useSyncExternalStore(
    subscribeFogStatus,
    getFogStatus,
    getFogStatus
  )
  if (status.phase !== "failed" && status.phase !== "degraded") return null

  const isFailed = status.phase === "failed"
  const message = isFailed
    ? (status.error ?? "Fog could not be rebuilt.")
    : "Some routes could not clear fog; your activities are safe."

  return (
    <div
      data-testid="fog-status"
      role="alert"
      className="flex max-w-[min(28rem,calc(100vw-1.5rem))] items-center gap-2 border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <WarningIcon
        weight="duotone"
        className={
          isFailed
            ? "size-4 shrink-0 text-destructive"
            : "size-4 shrink-0 text-amber-600"
        }
      />
      <span className="min-w-0 flex-1 text-pretty text-muted-foreground">
        {message}
        {!isFailed && status.warnings.length > 0
          ? ` (${status.warnings.length} warning${status.warnings.length === 1 ? "" : "s"})`
          : ""}
      </span>
      <Button
        variant="outline"
        size="xs"
        onClick={onRetry}
        aria-label="Retry fog processing"
      >
        <ArrowClockwiseIcon weight="bold" />
        Retry
      </Button>
    </div>
  )
}
