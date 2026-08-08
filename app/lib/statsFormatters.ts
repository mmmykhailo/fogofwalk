// ─── Stat formatters ──────────────────────────────────────────────────────────

export function formatKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`
  return `${km.toFixed(1)} km`
}

export function formatElevation(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m)} m`
}

export function formatPace(minPerKm: number): string {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, "0")}/km`
}

export function formatSpeed(kmh: number): string {
  return `${kmh.toFixed(1)} km/h`
}

export function formatMovingTime(ms: number): string {
  const totalH = ms / 3_600_000
  if (totalH >= 100) return `${Math.round(totalH)} h`
  const h = Math.floor(totalH)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h === 0) return `${m} min`
  return `${h}h ${m}m`
}

export function formatXAxisTick(startMs: number): string {
  return new Date(startMs).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  })
}

export function formatWeekRange(startMs: number): string {
  const start = new Date(startMs)
  const end = new Date(startMs + 6 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `${fmt(start)} – ${fmt(end)}`
}
