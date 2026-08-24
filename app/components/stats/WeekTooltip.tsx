import type { WeeklyBar } from "~/lib/statsAggregator"
import { formatWeekRange } from "~/lib/statsFormatters"

interface WeekTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: WeeklyBar }>
}

/**
 * Recharts tooltip for WeeklyChart. Hand-rolled rather than ChartTooltipContent
 * because it reads the whole WeeklyBar payload, not just the hovered series.
 */
export function WeekTooltip({ active, payload }: WeekTooltipProps) {
  if (!active || !payload?.length) return null
  const bar = payload[0]?.payload
  if (!bar) return null
  return (
    <div className="grid min-w-32 gap-1.5 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{formatWeekRange(bar.startMs)}</p>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Distance</span>
        <span className="font-mono font-medium text-foreground tabular-nums">
          {bar.distanceKm.toFixed(1)} km
        </span>
      </div>
      {bar.activityCount > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Activities</span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {bar.activityCount}
          </span>
        </div>
      )}
    </div>
  )
}
