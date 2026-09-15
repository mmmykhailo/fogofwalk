import type { PublicActivitySummary } from "~shared/api"
import type {
  ActivityLap,
  ActivityPaths,
  ActivityStats,
  ActivityType,
  ParsedActivity,
  StartSunPhase,
} from "~shared/activities"

import type { ActivitySummary } from "~/types/activitySummary"

export const FIXTURE_ACTIVITY_START_MS = Date.parse("2026-09-15T06:30:00.000Z")

const DEFAULT_COORDINATES: [number, number][] = [
  [14.4172, 50.0755],
  [14.4211, 50.0784],
  [14.4268, 50.0801],
  [14.4325, 50.083],
]

const DEFAULT_STATS: ActivityStats = {
  distanceKm: 7.4,
  uniqueDistanceKm: 6.8,
  elevationGainM: 124,
  elevationLossM: 118,
  hasElevation: true,
  durationMs: 2_664_000,
  movingTimeMs: 2_430_000,
  avgPaceMinPerKm: 6,
  avgMovingPaceMinPerKm: 5.47,
  avgSpeedKmh: 10.01,
  avgMovingSpeedKmh: 10.96,
  elevationProfile: [
    { distanceKm: 0, elevationM: 242 },
    { distanceKm: 2.4, elevationM: 278 },
    { distanceKm: 4.8, elevationM: 259 },
    { distanceKm: 7.4, elevationM: 301 },
  ],
}

type ParsedActivityOverrides = Omit<
  Partial<ParsedActivity>,
  "stats" | "coordinates" | "paths" | "pointTimestamps" | "pathTimestamps"
> & {
  stats?: Partial<ActivityStats>
  coordinates?: [number, number][]
  paths?: ActivityPaths
  pointTimestamps?: Array<number | null>
  pathTimestamps?: Array<Array<number | null>>
}

function cloneCoordinates(coordinates: readonly [number, number][]) {
  return coordinates.map(([lng, lat]) => [lng, lat] as [number, number])
}

function clonePaths(paths: readonly (readonly [number, number][])[]) {
  return paths.map((path) => cloneCoordinates(path))
}

function defaultTimestamps(count: number) {
  return Array.from(
    { length: count },
    (_, index) => FIXTURE_ACTIVITY_START_MS + index * 600_000
  )
}

export function makeParsedActivity(
  overrides: ParsedActivityOverrides = {}
): ParsedActivity {
  const coordinates = cloneCoordinates(
    overrides.coordinates ?? overrides.paths?.[0] ?? DEFAULT_COORDINATES
  )
  const paths = clonePaths(overrides.paths ?? [coordinates])
  const pointTimestamps =
    overrides.pointTimestamps === undefined
      ? defaultTimestamps(coordinates.length)
      : [...overrides.pointTimestamps]
  const pathTimestamps =
    overrides.pathTimestamps === undefined
      ? paths.map((path, pathIndex) =>
          defaultTimestamps(path.length).map(
            (timestamp) => timestamp + pathIndex * 86_400_000
          )
        )
      : overrides.pathTimestamps.map((timestamps) => [...timestamps])

  return {
    id: "activity-fixture-1",
    name: "Riverside loop",
    startedAtMs: FIXTURE_ACTIVITY_START_MS,
    coordinates,
    paths,
    pointTimestamps,
    pathTimestamps,
    format: "gpx",
    activityType: "walking",
    startSunPhase: "daylight",
    stats: { ...DEFAULT_STATS, ...overrides.stats },
    contentHash: "fixture-content-hash-1",
    isPublic: false,
    ...overrides,
    coordinates,
    paths,
    pointTimestamps,
    pathTimestamps,
    stats: { ...DEFAULT_STATS, ...overrides.stats },
    ...(overrides.laps
      ? { laps: overrides.laps.map((lap) => cloneLap(lap)) }
      : {}),
  }
}

function cloneLap(lap: ActivityLap): ActivityLap {
  return {
    ...lap,
    pathRanges: lap.pathRanges?.map((range) => ({ ...range })),
    stats: {
      ...lap.stats,
      elevationProfile: lap.stats.elevationProfile.map((point) => ({
        ...point,
      })),
    },
  }
}

type ActivitySummaryOverrides = Omit<Partial<ActivitySummary>, "stats"> & {
  stats?: Partial<ActivitySummary["stats"]>
}

export function makeActivitySummary(
  overrides: ActivitySummaryOverrides = {}
): ActivitySummary {
  const id = overrides.id ?? "activity-summary-1"
  return {
    id,
    name: "Riverside loop",
    startedAtMs: FIXTURE_ACTIVITY_START_MS,
    activityType: "walking",
    startSunPhase: "daylight",
    contentHash: `fixture-content-hash-${id}`,
    isPublic: false,
    stats: {
      distanceKm: 7.4,
      durationMs: 2_664_000,
      elevationGainM: 124,
      avgMovingSpeedKmh: 10.96,
      ...overrides.stats,
    },
    ...overrides,
    stats: {
      distanceKm: 7.4,
      durationMs: 2_664_000,
      elevationGainM: 124,
      avgMovingSpeedKmh: 10.96,
      ...overrides.stats,
    },
  }
}

export function makePublicActivity(
  overrides: Partial<PublicActivitySummary> = {}
): PublicActivitySummary {
  return {
    contentHash: "fixture-public-hash-1",
    name: "Public riverside loop",
    activityType: "walking",
    startSunPhase: "daylight",
    startedAtMs: FIXTURE_ACTIVITY_START_MS,
    distanceKm: 7.4,
    durationMs: 2_664_000,
    movingTimeMs: 2_430_000,
    elevationGainM: 124,
    avgMovingSpeedKmh: 10.96,
    ...overrides,
  }
}

export function makeActivityWithType(
  activityType: ActivityType,
  overrides: ParsedActivityOverrides = {}
) {
  return makeParsedActivity({ ...overrides, activityType })
}

export function makeActivityWithSunPhase(
  startSunPhase: StartSunPhase,
  overrides: ParsedActivityOverrides = {}
) {
  return makeParsedActivity({ ...overrides, startSunPhase })
}
