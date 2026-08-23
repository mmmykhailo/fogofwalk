import type { PublicTrackMeta } from "~shared/api"
import type { LifetimeTotals, WeeklyBar } from "~/lib/statsAggregator"

export interface PublicProfileStats {
  totals: LifetimeTotals
  firstActivityMs: number | null
  latestActivityMs: number | null
  recentDays: string[]
  weekly: WeeklyBar[]
}

function toLocalDateStr(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function startOfWeek(ms: number): number {
  const date = new Date(ms)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function nextWeek(startMs: number): number {
  const date = new Date(startMs)
  date.setDate(date.getDate() + 7)
  return date.getTime()
}

function toWeekLabel(startMs: number): string {
  return new Date(startMs).toISOString().slice(0, 10)
}

function buildWeeklyBars(tracks: PublicTrackMeta[]): WeeklyBar[] {
  const datedTracks = tracks.filter(
    (track): track is PublicTrackMeta & { startedAtMs: number } =>
      track.startedAtMs != null
  )
  if (datedTracks.length === 0) return []

  const bars = new Map<number, WeeklyBar>()

  for (const track of datedTracks) {
    const startMs = startOfWeek(track.startedAtMs)
    const bar = bars.get(startMs) ?? {
      startMs,
      week: toWeekLabel(startMs),
      distanceKm: 0,
      trackCount: 0,
    }
    bar.distanceKm += track.distanceKm
    bar.trackCount += 1
    bars.set(startMs, bar)
  }

  const starts = [...bars.keys()].sort((a, b) => a - b)
  const result: WeeklyBar[] = []
  for (
    let cursor = starts[0];
    cursor <= starts.at(-1)!;
    cursor = nextWeek(cursor)
  ) {
    const bar = bars.get(cursor)
    result.push(
      bar
        ? {
            startMs: bar.startMs,
            week: bar.week,
            distanceKm: bar.distanceKm,
            trackCount: bar.trackCount,
          }
        : {
            startMs: cursor,
            week: toWeekLabel(cursor),
            distanceKm: 0,
            trackCount: 0,
          }
    )
  }
  return result
}

export function computePublicProfileStats(
  tracks: PublicTrackMeta[]
): PublicProfileStats {
  let totalDistanceKm = 0
  let totalElevationGainM = 0
  let totalMovingTimeMs = 0
  let timedDistanceKm = 0
  let totalDurationMs = 0
  let movingDistanceKm = 0
  const dates: number[] = []
  const recentDays = new Set<string>()

  for (const track of tracks) {
    totalDistanceKm += track.distanceKm
    totalElevationGainM += track.elevationGainM
    if (track.durationMs != null && track.durationMs > 0) {
      timedDistanceKm += track.distanceKm
      totalDurationMs += track.durationMs
    }
    if (track.movingTimeMs != null && track.movingTimeMs > 0) {
      movingDistanceKm += track.distanceKm
      totalMovingTimeMs += track.movingTimeMs
    }
    if (track.startedAtMs != null) {
      dates.push(track.startedAtMs)
      recentDays.add(toLocalDateStr(track.startedAtMs))
    }
  }

  dates.sort((a, b) => a - b)
  return {
    totals: {
      totalDistanceKm,
      totalElevationGainM,
      totalMovingTimeMs,
      totalTracks: tracks.length,
      activeDays: recentDays.size,
      avgSpeedKmh:
        totalDurationMs > 0
          ? timedDistanceKm / (totalDurationMs / 3_600_000)
          : null,
      avgMovingSpeedKmh:
        totalMovingTimeMs > 0
          ? movingDistanceKm / (totalMovingTimeMs / 3_600_000)
          : null,
      avgPaceMinPerKm:
        totalDurationMs > 0 ? totalDurationMs / 60_000 / timedDistanceKm : null,
      avgMovingPaceMinPerKm:
        totalMovingTimeMs > 0
          ? totalMovingTimeMs / 60_000 / movingDistanceKm
          : null,
    },
    firstActivityMs: dates[0] ?? null,
    latestActivityMs: dates.at(-1) ?? null,
    recentDays: [...recentDays],
    weekly: buildWeeklyBars(tracks),
  }
}
