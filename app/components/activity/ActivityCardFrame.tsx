import type { PublicActivityMeta } from "~shared/api"
import type { ReactNode } from "react"
import { AppLink } from "~/components/AppLink"
import { formatRelativeTime } from "~/lib/formatRelativeTime"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "~/components/activity-stats/formatters"
import { Stat } from "~/components/public-profile/Stat"

export interface ActivityCardData {
  name: string
  startedAtMs: number | null
  distanceKm: number
  durationMs: number | null
  elevationGainM: number
  avgMovingSpeedKmh: number | null
}

interface ActivityCardFrameProps {
  activity: PublicActivityMeta | ActivityCardData
  activityId?: string
  /** Local map destination. Public-profile activities intentionally have none. */
  activityHref?: string
  selectionControl?: ReactNode
  settingsControls?: ReactNode
  actions?: ReactNode
}

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".")
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

export function ActivityCardFrame({
  activity,
  activityId,
  activityHref,
  selectionControl,
  settingsControls,
  actions,
}: ActivityCardFrameProps) {
  const activityName = stripExtension(activity.name)

  return (
    <div
      data-testid={activityId ? `activity-card-${activityId}` : undefined}
      className="@container flex flex-col gap-2 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex items-start justify-between gap-2">
        {selectionControl}
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-sm font-medium">
            {activityHref ? (
              <AppLink
                to={activityHref}
                className="block truncate"
                title={activityName}
              >
                {activityName}
              </AppLink>
            ) : (
              activityName
            )}
          </h3>
          {activity.startedAtMs != null && (
            <p
              className="text-xs text-muted-foreground"
              title={new Date(activity.startedAtMs).toLocaleString()}
            >
              {formatRelativeTime(activity.startedAtMs)}
            </p>
          )}
        </div>
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {settingsControls}
          {actions}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs @sm:grid-cols-4">
        <Stat label="Distance" value={formatDistance(activity.distanceKm)} />
        {activity.durationMs != null && (
          <Stat label="Duration" value={formatDuration(activity.durationMs)} />
        )}
        {activity.elevationGainM > 0 && (
          <Stat
            label="Elevation gain"
            value={formatElevation(activity.elevationGainM)}
          />
        )}
        {activity.avgMovingSpeedKmh != null && (
          <Stat
            label="Moving speed"
            value={formatSpeed(activity.avgMovingSpeedKmh)}
          />
        )}
      </dl>
    </div>
  )
}
