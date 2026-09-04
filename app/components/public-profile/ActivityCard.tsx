import type { PublicActivityMeta } from "~shared/api"
import { Menu } from "@base-ui/react/menu"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { ReactNode } from "react"
import { AppLink } from "~/components/AppLink"
import { formatRelativeTime } from "~/lib/formatRelativeTime"
import { updateActivityVisibility } from "~/lib/server/activityVisibility"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "~/components/activity-stats/formatters"
import { Stat } from "~/components/public-profile/Stat"

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".")
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

export interface ActivityCardData {
  name: string
  startedAtMs: number | null
  distanceKm: number
  durationMs: number | null
  elevationGainM: number
  avgMovingSpeedKmh: number | null
}

interface ActivityCardProps {
  activity: PublicActivityMeta | ActivityCardData
  activityId?: string
  /** Local map destination. Public-profile activities intentionally have none. */
  activityHref?: string
  selectionControl?: ReactNode
  settingsControls?: ReactNode
  isOwner?: boolean
  onHidden?: (contentHash: string) => void
}

export function ActivityCard({
  activity,
  activityId,
  activityHref,
  selectionControl,
  settingsControls,
  isOwner = false,
  onHidden,
}: ActivityCardProps) {
  const [isHiding, setIsHiding] = useState(false)
  const activityName = stripExtension(activity.name)
  const contentHash = "contentHash" in activity ? activity.contentHash : null

  async function handleHide() {
    if (contentHash == null) return

    setIsHiding(true)
    try {
      await updateActivityVisibility(contentHash, false)
      onHidden?.(contentHash)
    } catch (err) {
      console.warn("[public-profile] failed to hide activity:", err)
    } finally {
      setIsHiding(false)
    }
  }

  return (
    <div
      data-testid={activityId ? `activity-card-${activityId}` : undefined}
      className="@container flex flex-col gap-2 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
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
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {settingsControls}
          {isOwner && contentHash != null && (
            <Menu.Root>
              <Menu.Trigger
                aria-label={`Activity actions for ${activityName}`}
                className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={isHiding}
              >
                <DotsThreeIcon size={18} weight="bold" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner align="end" sideOffset={4}>
                  <Menu.Popup className="z-50 min-w-40 border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
                    <Menu.Item
                      className="flex w-full cursor-pointer items-center px-2 py-1.5 text-sm outline-none hover:bg-muted data-[highlighted]:bg-muted"
                      disabled={isHiding}
                      onClick={handleHide}
                    >
                      Hide from profile
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
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
