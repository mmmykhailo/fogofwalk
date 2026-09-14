import type {
  ActivityLap,
  ActivityPathTimestamps,
  ActivityPaths,
  ParsedActivity,
} from "~/types/activities"
import {
  flattenActivityPaths,
  pathTimestampsForActivity,
  pathsForActivity,
} from "~shared/activityContract"

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
  const parentPaths = pathsForActivity(activity)
  const parentTimestamps = pathTimestampsForActivity(activity)
  const paths: ActivityPaths = []
  const pathTimestamps: ActivityPathTimestamps[] = []

  if (lap.pathRanges && lap.pathRanges.length > 0) {
    for (const range of lap.pathRanges) {
      const parentPath = parentPaths[range.pathIndex]
      if (!parentPath) continue
      if (
        !Number.isSafeInteger(range.startIndex) ||
        !Number.isSafeInteger(range.endIndex) ||
        range.startIndex < 0 ||
        range.endIndex < range.startIndex ||
        range.endIndex >= parentPath.length
      ) {
        continue
      }
      paths.push(parentPath.slice(range.startIndex, range.endIndex + 1))
      if (parentTimestamps) {
        pathTimestamps.push(
          (parentTimestamps[range.pathIndex] ?? []).slice(
            range.startIndex,
            range.endIndex + 1
          )
        )
      }
    }
  } else {
    const parentPath = parentPaths[0]
    if (
      parentPath &&
      Number.isSafeInteger(lap.startIndex) &&
      Number.isSafeInteger(lap.endIndex) &&
      lap.startIndex >= 0 &&
      lap.endIndex >= lap.startIndex &&
      lap.endIndex < parentPath.length
    ) {
      const end = lap.endIndex + 1
      paths.push(parentPath.slice(lap.startIndex, end))
      if (parentTimestamps) {
        pathTimestamps.push(
          (parentTimestamps[0] ?? []).slice(lap.startIndex, end)
        )
      }
    }
  }

  const coordinates = flattenActivityPaths(paths)
  const hasTimestamps = parentTimestamps != null
  return {
    id: `${activity.id}#lap${lap.number}`,
    name: `${stripExt(activity.name)} — Lap ${lap.number}`,
    startedAtMs: lap.startedAtMs,
    coordinates,
    paths,
    ...(hasTimestamps
      ? {
          pathTimestamps,
          pointTimestamps: pathTimestamps.flatMap((path) =>
            path.map((timestamp) => timestamp ?? -1)
          ),
        }
      : {}),
    format: activity.format,
    stats: lap.stats,
    // Deliberately no `laps` — nesting the full lap array (with every lap's
    // elevation profile) into each share render would be pure waste.
  }
}
