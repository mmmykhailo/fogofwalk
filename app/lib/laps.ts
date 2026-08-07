import type { ParsedTrack, TrackLap } from "~/types/tracks"

// Format-agnostic lap helpers used on the render path. Extracting laps from a
// file is the parser's job — see `buildLapsFromFit` in lib/parsers/fit.ts.

/** "2024-05-03-081500.fit" → "2024-05-03-081500" */
export function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "")
}

export function lapSubtitle(track: ParsedTrack, lap: TrackLap): string {
  return `${stripExt(track.name)} · Lap ${lap.number}`
}

/**
 * Builds a throwaway `ParsedTrack` standing in for a single lap, so the share
 * pipeline (`ShareDialog`, `drawShareCard`, `ShareMapView`, `trackToStatsData`,
 * `filterPhotosForTrack`) can render a lap without any of it knowing laps exist.
 *
 * Render path only. This must never reach `mapStore.tracks`, `saveTracks`,
 * `populateUniqueDistances` or the fog worker — its id is synthetic, so e.g.
 * `deleteTrack` on it would be a silent no-op.
 */
export function buildLapTrack(track: ParsedTrack, lap: TrackLap): ParsedTrack {
  const end = lap.endIndex + 1
  return {
    id: `${track.id}#lap${lap.number}`,
    name: `${stripExt(track.name)} — Lap ${lap.number}`,
    startedAtMs: lap.startedAtMs,
    coordinates: track.coordinates.slice(lap.startIndex, end),
    pointTimestamps: track.pointTimestamps?.slice(lap.startIndex, end),
    format: track.format,
    stats: lap.stats,
    // Deliberately no `laps` — nesting the full lap array (with every lap's
    // elevation profile) into each share render would be pure waste.
  }
}
