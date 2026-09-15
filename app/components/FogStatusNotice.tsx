import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"
import { useFogStatus } from "~/lib/mapStore"
import type { FogProjectionStatus } from "~/lib/mapStore"

export function FogStatusNotice({ onRetry }: { onRetry: () => void }) {
  const status = useFogStatus()
  return <FogStatusNoticeView status={status} onRetry={onRetry} />
}

export function FogStatusNoticeView({
  status,
  onRetry,
}: {
  status: FogProjectionStatus
  onRetry: () => void
}) {
  if (status.phase !== "failed" && status.phase !== "degraded") return null

  const isFailed = status.phase === "failed"
  const rejected = status.rejectedActivityCount
  const fallbacks = status.geometryFallbackCount
  const coverageReduced = status.coverageReducedActivityCount
  const unionFailures = status.warningCounts["explored-mask-union-failed"] ?? 0
  const validationBudgetFailures =
    status.coverageReducedCounts.validation_budget_exceeded ?? 0
  const message = isFailed
    ? (status.error ?? "Fog could not be rebuilt.")
    : rejected > 0
      ? `${rejected} route${rejected === 1 ? "" : "s"} could not clear fog; your activities are safe.`
      : fallbacks > 0
        ? `${fallbacks} explored region${fallbacks === 1 ? " remains" : "s remain"} covered because the geometry could not be validated; your activities are safe.`
        : validationBudgetFailures > 0
          ? `${validationBudgetFailures} explored region${validationBudgetFailures === 1 ? " exceeded" : "s exceeded"} the validation budget and remain covered; your activities are safe.`
          : coverageReduced > 0
            ? `${coverageReduced} route${coverageReduced === 1 ? " was" : "s were"} cleared with reduced coverage; your activities are safe.`
            : unionFailures > 0
              ? `${unionFailures} explored region${unionFailures === 1 ? " was" : "s were"} kept separate because the regions could not be merged safely.`
              : "Fog completed with reduced coverage; your activities are safe."

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
      </span>
      {status.retryable && (
        <Button
          variant="outline"
          size="xs"
          onClick={onRetry}
          aria-label="Retry fog processing"
        >
          <ArrowClockwiseIcon weight="bold" />
          Retry
        </Button>
      )}
    </div>
  )
}
