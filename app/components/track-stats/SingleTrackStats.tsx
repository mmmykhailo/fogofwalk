import type { TrackLap, TrackStats } from "~/types/tracks"
import { ElevationChart } from "~/components/ElevationChart"
import { formatPace } from "~/lib/statsFormatters"
import { LapSelector } from "./LapSelector"
import { StatRow } from "./StatRow"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "./formatters"

interface SingleTrackStatsProps {
  /** Already resolved to the lap's stats when a lap is selected. */
  stats: TrackStats
  laps?: TrackLap[]
  activeLap: TrackLap | null
  onLapSelect?: (lapNumber: number | null) => void
}

export function SingleTrackStats({
  stats,
  laps,
  activeLap,
  onLapSelect,
}: SingleTrackStatsProps) {
  // Read from the displayed stats, not from the track — with a lap selected the
  // track's unique km over the lap's distance would print over 100%. Laps
  // always carry 0 here (see lib/laps.ts), and the > 0 guard hides the row.
  const uniqueKm = stats.uniqueDistanceKm

  return (
    <div className="flex flex-col gap-3">
      {laps && laps.length >= 2 && onLapSelect && (
        <LapSelector
          laps={laps}
          activeLapNumber={activeLap?.number ?? null}
          onLapSelect={onLapSelect}
        />
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <StatRow label="Distance" value={formatDistance(stats.distanceKm)} />
        {uniqueKm > 0 && stats.distanceKm > 0 && (
          <StatRow
            label="Unique distance"
            value={`${formatDistance(uniqueKm)} (${Math.round((uniqueKm / stats.distanceKm) * 100)}%)`}
          />
        )}
        {stats.durationMs != null && (
          <StatRow label="Duration" value={formatDuration(stats.durationMs)} />
        )}
        {stats.movingTimeMs != null && (
          <StatRow
            label="Moving time"
            value={formatDuration(stats.movingTimeMs)}
          />
        )}
        {stats.avgPaceMinPerKm != null && (
          <StatRow label="Avg pace" value={formatPace(stats.avgPaceMinPerKm)} />
        )}
        {stats.avgMovingPaceMinPerKm != null && (
          <StatRow
            label="Avg moving pace"
            value={formatPace(stats.avgMovingPaceMinPerKm)}
          />
        )}
        {stats.avgSpeedKmh != null && (
          <StatRow label="Avg speed" value={formatSpeed(stats.avgSpeedKmh)} />
        )}
        {stats.avgMovingSpeedKmh != null && (
          <StatRow
            label="Avg moving speed"
            value={formatSpeed(stats.avgMovingSpeedKmh)}
          />
        )}
        {stats.hasElevation && (
          <>
            <StatRow
              label="Elevation ↑"
              value={formatElevation(stats.elevationGainM)}
            />
            <StatRow
              label="Elevation ↓"
              value={formatElevation(stats.elevationLossM)}
            />
          </>
        )}
      </div>
      {stats.hasElevation && stats.elevationProfile.length >= 2 && (
        <ElevationChart profile={stats.elevationProfile} />
      )}
    </div>
  )
}
