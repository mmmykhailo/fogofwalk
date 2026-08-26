import type { ParsedActivity, ActivityLap } from "~/types/activities"

// Format-agnostic lap helpers used on the render path. Extracting laps from a
// file is the parser's job — see `buildLapsFromFit` in lib/parsers/fit.ts.

/** "2024-05-03-081500.fit" → "2024-05-03-081500" */
export function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "")
}

export function lapSubtitle(
  activity: ParsedActivity,
  lap: ActivityLap
): string {
  return `${stripExt(activity.name)} · Lap ${lap.number}`
}

/**
 * Builds a throwaway `ParsedActivity` standing in for a single lap, so the share
 * pipeline (`ShareDialog`, `drawShareCard`, `ShareMapView`, `activityToStatsData`,
 * `filterPhotosForActivity`) can render a lap without any of it knowing laps exist.
 *
 * Render path only. This must never reach `mapStore.activities`, `saveActivities`,
 * `populateUniqueDistances` or the fog worker — its id is synthetic, so e.g.
 * `deleteActivity` on it would be a silent no-op.
 */
export function buildLapActivity(
  activity: ParsedActivity,
  lap: ActivityLap
): ParsedActivity {
  const end = lap.endIndex + 1
  return {
    id: `${activity.id}#lap${lap.number}`,
    name: `${stripExt(activity.name)} — Lap ${lap.number}`,
    startedAtMs: lap.startedAtMs,
    coordinates: activity.coordinates.slice(lap.startIndex, end),
    pointTimestamps: activity.pointTimestamps?.slice(lap.startIndex, end),
    format: activity.format,
    stats: lap.stats,
    // Deliberately no `laps` — nesting the full lap array (with every lap's
    // elevation profile) into each share render would be pure waste.
  }
}
