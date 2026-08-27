import { XIcon } from "@phosphor-icons/react"
import type { ParsedActivity } from "~/types/activities"
import { Button } from "~/components/ui/button"
import type { CompositeStats } from "~/lib/shareCard"
import { formatPace } from "~/lib/statsFormatters"
import { StatRow } from "./StatRow"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "./formatters"

interface MultiActivityStatsProps {
  activities: ParsedActivity[]
  composite: CompositeStats
  onRemoveActivity?: (id: string) => void
}

/** Totals across a multi-activity selection. No lap selector, no elevation chart. */
export function MultiActivityStats({
  activities,
  composite,
  onRemoveActivity,
}: MultiActivityStatsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        {activities.map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {t.name}
            </span>
            {onRemoveActivity && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveActivity(t.id)}
                aria-label={`Remove ${t.name}`}
                className="shrink-0 text-muted-foreground/50 hover:text-foreground"
              >
                <XIcon weight="bold" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <StatRow
          label="Total distance"
          value={formatDistance(composite.totalDistanceKm)}
        />
        {composite.totalUniqueKm > 0 && composite.totalDistanceKm > 0 && (
          <StatRow
            label="Unique distance"
            value={`${formatDistance(composite.totalUniqueKm)} (${Math.round((composite.totalUniqueKm / composite.totalDistanceKm) * 100)}%)`}
          />
        )}
        {composite.totalDurationMs != null && (
          <StatRow
            label="Total duration"
            value={formatDuration(composite.totalDurationMs)}
          />
        )}
        {composite.totalMovingTimeMs != null && (
          <StatRow
            label="Total moving time"
            value={formatDuration(composite.totalMovingTimeMs)}
          />
        )}
        {composite.avgPaceMinPerKm != null && (
          <StatRow
            label="Avg pace"
            value={formatPace(composite.avgPaceMinPerKm)}
          />
        )}
        {composite.avgMovingSpeedKmh != null && (
          <StatRow
            label="Avg moving speed"
            value={formatSpeed(composite.avgMovingSpeedKmh)}
          />
        )}
        {composite.hasElevation && (
          <>
            <StatRow
              label="Elevation ↑"
              value={formatElevation(composite.totalElevationGainM)}
            />
            <StatRow
              label="Elevation ↓"
              value={formatElevation(composite.totalElevationLossM)}
            />
          </>
        )}
      </div>
    </div>
  )
}
