// Presentation helpers for the activity stats panel.
//
// These deliberately differ from the same-named helpers in lib/statsFormatters:
// the panel wants precise readings (h:mm:ss durations, 2-decimal distances, raw
// metres) where the stats page wants scannable summaries ("4h 12m", 1 decimal,
// a km rollover above 1000 m). Pace is the one format both agree on, so it is
// imported from lib/statsFormatters rather than redefined here.

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

export function formatSpeed(kmh: number): string {
  return `${kmh.toFixed(1)} km/h`
}

export function formatDistance(km: number): string {
  return `${km.toFixed(2)} km`
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}
