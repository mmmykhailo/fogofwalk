import type { PublicTrackMeta } from "~shared/api"
import { Menu } from "@base-ui/react/menu"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { AppLink } from "~/components/AppLink"
import { formatRelativeTime } from "~/lib/formatRelativeTime"
import { updateTrackVisibility } from "~/lib/server/trackVisibility"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "~/components/track-stats/formatters"
import { Stat } from "~/components/public-profile/Stat"

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".")
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

export interface TrackCardData {
  name: string
  startedAtMs: number | null
  distanceKm: number
  durationMs: number | null
  elevationGainM: number
  avgMovingSpeedKmh: number | null
}

interface TrackCardProps {
  track: PublicTrackMeta | TrackCardData
  /** Local map destination. Public-profile tracks intentionally have none. */
  trackHref?: string
  isOwner?: boolean
  onHidden?: (contentHash: string) => void
}

export function TrackCard({
  track,
  trackHref,
  isOwner = false,
  onHidden,
}: TrackCardProps) {
  const [isHiding, setIsHiding] = useState(false)
  const trackName = stripExtension(track.name)
  const contentHash = "contentHash" in track ? track.contentHash : null

  async function handleHide() {
    if (contentHash == null) return

    setIsHiding(true)
    try {
      await updateTrackVisibility(contentHash, false)
      onHidden?.(contentHash)
    } catch (err) {
      console.warn("[public-profile] failed to hide track:", err)
    } finally {
      setIsHiding(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-medium">
            {trackHref ? (
              <AppLink
                to={trackHref}
                className="block truncate"
                title={trackName}
              >
                {trackName}
              </AppLink>
            ) : (
              trackName
            )}
          </h3>
          {track.startedAtMs != null && (
            <p
              className="text-xs text-muted-foreground"
              title={new Date(track.startedAtMs).toLocaleString()}
            >
              {formatRelativeTime(track.startedAtMs)}
            </p>
          )}
        </div>
        {isOwner && contentHash != null && (
          <Menu.Root>
            <Menu.Trigger
              aria-label={`Track actions for ${trackName}`}
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
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Stat label="Distance" value={formatDistance(track.distanceKm)} />
        {track.durationMs != null && (
          <Stat label="Duration" value={formatDuration(track.durationMs)} />
        )}
        {track.elevationGainM > 0 && (
          <Stat
            label="Elevation gain"
            value={formatElevation(track.elevationGainM)}
          />
        )}
        {track.avgMovingSpeedKmh != null && (
          <Stat
            label="Moving speed"
            value={formatSpeed(track.avgMovingSpeedKmh)}
          />
        )}
      </dl>
    </div>
  )
}
