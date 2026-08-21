import { TrackCard } from "~/components/public-profile/TrackCard"
import type { ParsedTrack } from "~/types/tracks"

interface TrackGridProps {
  tracks: ParsedTrack[]
}

export function TrackGrid({ tracks }: TrackGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {tracks.map((track) => (
        <TrackCard
          key={track.id}
          track={{
            name: track.name,
            startedAtMs: track.startedAtMs,
            distanceKm: track.stats.distanceKm,
            durationMs: track.stats.durationMs,
            elevationGainM: track.stats.elevationGainM,
            avgMovingSpeedKmh: track.stats.avgMovingSpeedKmh,
          }}
          trackHref={`/?track=${track.id}`}
        />
      ))}
    </div>
  )
}
