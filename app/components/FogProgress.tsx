import { useSyncExternalStore } from "react"
import { getFogProcessedCount, subscribeFogProgress } from "~/lib/mapStore"

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
  return (
    <>
      Processing {processedCount} of {activityCount}…
    </>
  )
}
