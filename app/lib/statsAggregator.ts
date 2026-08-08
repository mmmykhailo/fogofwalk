import type { ParsedTrack } from "~/types/tracks"
import { haversineKm } from "~/lib/stats"

// Grid resolution: 0.001° ≈ 111 m per cell, matching FOG_CLEAR_RADIUS_METERS = 100 m
const GRID_SCALE = 1000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LifetimeTotals {
  totalDistanceKm: number
  totalElevationGainM: number
  totalMovingTimeMs: number
  totalTracks: number
  activeDays: number
}

export interface WeeklyBar {
  /** ISO week label e.g. "2024-W03" */
  week: string
  /** Monday of that week in ms — used for x-axis labels */
  startMs: number
  distanceKm: number
  trackCount: number
}

export interface Streaks {
  currentStreakDays: number
  longestStreakDays: number
  /** "YYYY-MM-DD" strings for the last 84 days (12 weeks) that had activity */
  recentDays: string[]
  /** Total km in the current ISO week */
  thisWeekKm: number
  /** Total km in the previous ISO week */
  lastWeekKm: number
  /** Unique active days within the 84-day window */
  activeInWindowCount: number
}

export interface PersonalRecords {
  longestActivity: { track: ParsedTrack; distanceKm: number } | null
  mostElevation: { track: ParsedTrack; elevationGainM: number } | null
  fastestPace: { track: ParsedTrack; paceMinPerKm: number } | null
  fastestAvgSpeed: { track: ParsedTrack; avgSpeedKmh: number } | null
  longestMovingTime: { track: ParsedTrack; movingTimeMs: number } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "YYYY-Www" (ISO 8601 week) for a given ms timestamp. */
function toISOWeek(ms: number): string {
  const d = new Date(ms)
  // Copy the date so we don't mutate
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // ISO weeks start on Monday; day 0 = Sunday in JS
  const day = tmp.getUTCDay() || 7
  // Thursday of the current week determines the year
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const year = tmp.getUTCFullYear()
  const startOfYear = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(
    ((tmp.getTime() - startOfYear.getTime()) / 86_400_000 + 1) / 7
  )
  return `${year}-W${String(week).padStart(2, "0")}`
}

/** Returns the Monday of the ISO week that contains the given ms timestamp. */
function mondayOfISOWeek(ms: number): number {
  const d = new Date(ms)
  const day = d.getUTCDay() || 7 // Mon=1 … Sun=7
  const monday = new Date(ms)
  monday.setUTCDate(d.getUTCDate() - (day - 1))
  monday.setUTCHours(0, 0, 0, 0)
  return monday.getTime()
}

/** Returns the local calendar date string "YYYY-MM-DD" for a ms timestamp. */
function toLocalDateStr(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

/**
 * Returns a new array of tracks sorted chronologically by startedAtMs.
 * Tracks without a timestamp are placed last.
 * Call this once at the data boundary (clientLoader / clientAction) so that
 * aggregators can iterate in order without re-sorting on every call.
 */
export function sortTracks(tracks: ParsedTrack[]): ParsedTrack[] {
  return [...tracks].sort((a, b) => {
    if (a.startedAtMs == null && b.startedAtMs == null) return 0
    if (a.startedAtMs == null) return 1
    if (b.startedAtMs == null) return -1
    return a.startedAtMs - b.startedAtMs
  })
}

// ─── Aggregators ──────────────────────────────────────────────────────────────

export function computeLifetimeTotals(tracks: ParsedTrack[]): LifetimeTotals {
  let totalDistanceKm = 0
  let totalElevationGainM = 0
  let totalMovingTimeMs = 0
  const daySet = new Set<string>()

  for (const t of tracks) {
    totalDistanceKm += t.stats.distanceKm
    totalElevationGainM += t.stats.elevationGainM
    totalMovingTimeMs += t.stats.movingTimeMs ?? 0
    if (t.startedAtMs != null) daySet.add(toLocalDateStr(t.startedAtMs))
  }

  return {
    totalDistanceKm,
    totalElevationGainM,
    totalMovingTimeMs,
    totalTracks: tracks.length,
    activeDays: daySet.size,
  }
}

export function computeWeeklyBars(tracks: ParsedTrack[]): WeeklyBar[] {
  // Only dated tracks contribute to the chart
  const dated = tracks.filter((t) => t.startedAtMs != null) as (ParsedTrack & {
    startedAtMs: number
  })[]
  if (dated.length === 0) return []

  // Accumulate per week
  const weekMap = new Map<string, WeeklyBar>()
  for (const t of dated) {
    const week = toISOWeek(t.startedAtMs)
    const existing = weekMap.get(week)
    if (existing) {
      existing.distanceKm += t.stats.distanceKm
      existing.trackCount += 1
    } else {
      weekMap.set(week, {
        week,
        startMs: mondayOfISOWeek(t.startedAtMs),
        distanceKm: t.stats.distanceKm,
        trackCount: 1,
      })
    }
  }

  // Sort by startMs
  const sorted = [...weekMap.values()].sort((a, b) => a.startMs - b.startMs)
  if (sorted.length === 0) return []

  // Fill in zero-distance weeks between first and last active week
  const result: WeeklyBar[] = []
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
  let cursor = sorted[0].startMs
  const end = sorted[sorted.length - 1].startMs

  const byStart = new Map(sorted.map((b) => [b.startMs, b]))

  while (cursor <= end) {
    const week = toISOWeek(cursor)
    result.push(
      byStart.get(cursor) ?? {
        week,
        startMs: cursor,
        distanceKm: 0,
        trackCount: 0,
      }
    )
    cursor += ONE_WEEK_MS
  }

  return result
}

export function computeStreaks(
  tracks: ParsedTrack[],
  todayMs: number
): Streaks {
  const dated = tracks.filter((t) => t.startedAtMs != null)
  if (dated.length === 0) {
    return {
      currentStreakDays: 0,
      longestStreakDays: 0,
      recentDays: [],
      thisWeekKm: 0,
      lastWeekKm: 0,
      activeInWindowCount: 0,
    }
  }

  // Unique local calendar days, sorted ascending
  const daySet = new Set(dated.map((t) => toLocalDateStr(t.startedAtMs!)))
  const days = [...daySet].sort()

  // Longest streak — single forward pass
  let longestStreakDays = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1])
    const curr = new Date(days[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      run++
      longestStreakDays = Math.max(longestStreakDays, run)
    } else {
      run = 1
    }
  }

  // Current streak — walk backward from today
  const todayStr = toLocalDateStr(todayMs)
  let currentStreakDays = 0
  const daySetLookup = new Set(days)
  let check = todayStr
  while (daySetLookup.has(check)) {
    currentStreakDays++
    const d = new Date(check)
    d.setDate(d.getDate() - 1)
    check = toLocalDateStr(d.getTime())
  }

  // Collect active days within the last 84 days (12 weeks) for the activity grid
  const cutoff = new Date(todayMs)
  cutoff.setDate(cutoff.getDate() - 83)
  const cutoffStr = toLocalDateStr(cutoff.getTime())
  const recentDays = [...daySet].filter((d) => d >= cutoffStr)
  const activeInWindowCount = recentDays.length

  // This week vs last week km
  const thisWeek = toISOWeek(todayMs)
  const lastWeekMs = todayMs - 7 * 24 * 60 * 60 * 1000
  const lastWeek = toISOWeek(lastWeekMs)
  let thisWeekKm = 0
  let lastWeekKm = 0
  for (const t of dated) {
    const w = toISOWeek(t.startedAtMs!)
    if (w === thisWeek) thisWeekKm += t.stats.distanceKm
    else if (w === lastWeek) lastWeekKm += t.stats.distanceKm
  }

  return {
    currentStreakDays,
    longestStreakDays,
    recentDays,
    thisWeekKm,
    lastWeekKm,
    activeInWindowCount,
  }
}

export function computePersonalRecords(tracks: ParsedTrack[]): PersonalRecords {
  if (tracks.length === 0) {
    return {
      longestActivity: null,
      mostElevation: null,
      fastestPace: null,
      fastestAvgSpeed: null,
      longestMovingTime: null,
    }
  }

  let longestActivity: PersonalRecords["longestActivity"] = null
  let mostElevation: PersonalRecords["mostElevation"] = null
  let fastestPace: PersonalRecords["fastestPace"] = null
  let fastestAvgSpeed: PersonalRecords["fastestAvgSpeed"] = null
  let longestMovingTime: PersonalRecords["longestMovingTime"] = null

  for (const t of tracks) {
    const {
      distanceKm,
      elevationGainM,
      avgMovingPaceMinPerKm,
      avgSpeedKmh,
      movingTimeMs,
    } = t.stats

    if (longestActivity == null || distanceKm > longestActivity.distanceKm) {
      longestActivity = { track: t, distanceKm }
    }

    if (
      mostElevation == null ||
      elevationGainM > mostElevation.elevationGainM
    ) {
      mostElevation = { track: t, elevationGainM }
    }

    if (
      avgMovingPaceMinPerKm != null &&
      avgMovingPaceMinPerKm > 0 &&
      (fastestPace == null || avgMovingPaceMinPerKm < fastestPace.paceMinPerKm)
    ) {
      fastestPace = { track: t, paceMinPerKm: avgMovingPaceMinPerKm }
    }

    if (
      avgSpeedKmh != null &&
      avgSpeedKmh > 0 &&
      (fastestAvgSpeed == null || avgSpeedKmh > fastestAvgSpeed.avgSpeedKmh)
    ) {
      fastestAvgSpeed = { track: t, avgSpeedKmh }
    }

    if (
      movingTimeMs != null &&
      movingTimeMs > 0 &&
      (longestMovingTime == null ||
        movingTimeMs > longestMovingTime.movingTimeMs)
    ) {
      longestMovingTime = { track: t, movingTimeMs }
    }
  }

  return {
    longestActivity,
    mostElevation,
    fastestPace,
    fastestAvgSpeed,
    longestMovingTime,
  }
}

/**
 * Returns a Map from track id → km of new ground covered by that track.
 *
 * Uses a grid-based midpoint check (~100 m cells) for O(n_segments) performance —
 * no polygon math, safe for 1000+ tracks.
 *
 * **Tracks must be pre-sorted chronologically** (call `sortTracks` first) so that
 * "new ground" has a deterministic meaning — earlier tracks claim ground first.
 *
 * Two passes per track:
 *   1. Count all segments whose midpoint cell is NOT in explored (= previous tracks' coverage).
 *   2. Mark this track's 3×3 neighbourhood into explored.
 *
 * Splitting check and mark into separate passes is critical: marking immediately
 * after each segment (in a single pass) causes the very next GPS point (~5 m away)
 * to land in an already-marked neighbour cell and be silently dropped, collapsing
 * the entire track's unique distance to nearly zero.
 */
function computePerTrackUniqueDistances(
  tracks: ParsedTrack[]
): Map<string, number> {
  const explored = new Set<string>()
  const result = new Map<string, number>()

  for (const track of tracks) {
    let trackUniqueKm = 0
    const coords = track.coordinates

    // Pass 1: count segments on new ground (vs. all previously processed tracks)
    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1]
      const [lng2, lat2] = coords[i]
      const cx = Math.round(((lng1 + lng2) / 2) * GRID_SCALE)
      const cy = Math.round(((lat1 + lat2) / 2) * GRID_SCALE)

      if (!explored.has(`${cx},${cy}`)) {
        trackUniqueKm += haversineKm(lng1, lat1, lng2, lat2)
      }
    }

    // Pass 2: mark this track's buffer as explored so later tracks can check against it
    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1]
      const [lng2, lat2] = coords[i]
      const cx = Math.round(((lng1 + lng2) / 2) * GRID_SCALE)
      const cy = Math.round(((lat1 + lat2) / 2) * GRID_SCALE)

      // 3×3 neighbourhood approximates the 100 m fog-clear buffer
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          explored.add(`${cx + dx},${cy + dy}`)
        }
      }
    }

    result.set(track.id, trackUniqueKm)
  }

  return result
}

/**
 * Total km traveled on ground not previously covered by any earlier track.
 * Thin wrapper around `computePerTrackUniqueDistances` — kept for the Stats page.
 * Tracks must be pre-sorted (call `sortTracks` first).
 */
export function computeUniqueDistance(tracks: ParsedTrack[]): number {
  let total = 0
  for (const km of computePerTrackUniqueDistances(tracks).values()) total += km
  return total
}

/** Compute unique distances and write them onto each track in place. Mutates the array elements. */
export function populateUniqueDistances(tracks: ParsedTrack[]): void {
  const result = computePerTrackUniqueDistances(tracks)
  for (const track of tracks) {
    track.stats.uniqueDistanceKm =
      result.get(track.id) ?? track.stats.distanceKm
  }
}
