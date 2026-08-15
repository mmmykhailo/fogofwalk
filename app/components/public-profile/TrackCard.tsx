import type { PublicTrackMeta } from "~shared/api"
import { formatRelativeTime } from "~/lib/formatRelativeTime"
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

export function TrackCard({ track }: { track: PublicTrackMeta }) {
  return (
    <div className="flex flex-col gap-2 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <div>
        <h3 className="font-heading text-sm font-medium">
          {stripExtension(track.name)}
        </h3>
        {track.startedAtMs != null && (
          <p className="text-xs text-muted-foreground">
            {formatRelativeTime(track.startedAtMs)}
          </p>
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
