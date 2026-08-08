import type { ParsedTrack } from "~/types/tracks"
import type { PhotoEntry } from "~/types/photos"

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatKey =
  | "distance"
  | "uniqueDistance"
  | "duration"
  | "movingTime"
  | "avgPace"
  | "avgMovingPace"
  | "avgSpeed"
  | "avgMovingSpeed"
  | "elevationGain"
  | "elevationLoss"

export interface StatsData {
  distanceKm: number
  uniqueDistanceKm: number
  durationMs: number | null
  movingTimeMs: number | null
  avgPaceMinPerKm: number | null
  avgMovingPaceMinPerKm: number | null
  avgSpeedKmh: number | null
  avgMovingSpeedKmh: number | null
  elevationGainM: number
  elevationLossM: number
  hasElevation: boolean
  trackCount: number
}

export interface StatDef {
  label: string
  getValue: (s: StatsData) => string
  unit: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1440

const TRACK_COLOR = "#ff6b35"
const FOG_COLOR = "#0a0a1e"
const FONT_FAMILY = "'JetBrains Mono Variable', 'JetBrains Mono', monospace"

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Duration without seconds: "1:24" (1h 24m) or "45" (45 min). */
function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}`
  return String(m)
}

function fmtPace(minPerKm: number): string {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

// ─── StatsData converters ─────────────────────────────────────────────────────

export function trackToStatsData(track: ParsedTrack): StatsData {
  const s = track.stats
  return {
    distanceKm: s.distanceKm,
    uniqueDistanceKm: s.uniqueDistanceKm,
    durationMs: s.durationMs ?? null,
    movingTimeMs: s.movingTimeMs ?? null,
    avgPaceMinPerKm: s.avgPaceMinPerKm ?? null,
    avgMovingPaceMinPerKm: s.avgMovingPaceMinPerKm ?? null,
    avgSpeedKmh: s.avgSpeedKmh ?? null,
    avgMovingSpeedKmh: s.avgMovingSpeedKmh ?? null,
    elevationGainM: s.elevationGainM,
    elevationLossM: s.elevationLossM,
    hasElevation: s.hasElevation,
    trackCount: 1,
  }
}

export function compositeToStatsData(composite: CompositeStats): StatsData {
  return {
    distanceKm: composite.totalDistanceKm,
    uniqueDistanceKm: composite.totalUniqueKm,
    durationMs: composite.totalDurationMs,
    movingTimeMs: composite.totalMovingTimeMs,
    avgPaceMinPerKm: null,
    avgMovingPaceMinPerKm: composite.avgPaceMinPerKm,
    avgSpeedKmh: null,
    avgMovingSpeedKmh: composite.avgMovingSpeedKmh,
    elevationGainM: composite.totalElevationGainM,
    elevationLossM: composite.totalElevationLossM,
    hasElevation: composite.hasElevation,
    trackCount: composite.trackCount,
  }
}

// ─── Stat definitions ─────────────────────────────────────────────────────────

export const STAT_DEFS: Record<StatKey, StatDef> = {
  distance: {
    label: "Distance",
    getValue: (s) => s.distanceKm.toFixed(2),
    unit: "distance (km)",
  },
  uniqueDistance: {
    label: "Unique dist.",
    getValue: (s) => s.uniqueDistanceKm.toFixed(2),
    unit: "unique distance (km)",
  },
  duration: {
    label: "Duration",
    getValue: (s) => fmtDuration(s.durationMs ?? 0),
    unit: "duration (h:m)",
  },
  movingTime: {
    label: "Moving time",
    getValue: (s) => fmtDuration(s.movingTimeMs ?? 0),
    unit: "moving time (h:m)",
  },
  avgPace: {
    label: "Avg. pace",
    getValue: (s) => fmtPace(s.avgPaceMinPerKm ?? 0),
    unit: "avg. pace (min/km)",
  },
  avgMovingPace: {
    label: "Moving pace",
    getValue: (s) => fmtPace(s.avgMovingPaceMinPerKm ?? 0),
    unit: "moving pace (min/km)",
  },
  avgSpeed: {
    label: "Avg. speed",
    getValue: (s) => (s.avgSpeedKmh ?? 0).toFixed(1),
    unit: "avg. speed (km/h)",
  },
  avgMovingSpeed: {
    label: "Moving speed",
    getValue: (s) => (s.avgMovingSpeedKmh ?? 0).toFixed(1),
    unit: "moving speed (km/h)",
  },
  elevationGain: {
    label: "Elevation gain",
    getValue: (s) => Math.round(s.elevationGainM).toString(),
    unit: "elevation gain (m)",
  },
  elevationLoss: {
    label: "Elevation loss",
    getValue: (s) => Math.round(s.elevationLossM).toString(),
    unit: "elevation loss (m)",
  },
}

// ─── Availability & defaults ──────────────────────────────────────────────────

export function getAvailableStats(s: StatsData): StatKey[] {
  const available: StatKey[] = ["distance"]
  if (s.uniqueDistanceKm > 0) available.push("uniqueDistance")
  if (s.durationMs != null) available.push("duration")
  if (s.movingTimeMs != null) available.push("movingTime")
  if (s.avgPaceMinPerKm != null) available.push("avgPace")
  if (s.avgMovingPaceMinPerKm != null) available.push("avgMovingPace")
  if (s.avgSpeedKmh != null) available.push("avgSpeed")
  if (s.avgMovingSpeedKmh != null) available.push("avgMovingSpeed")
  if (s.hasElevation) {
    available.push("elevationGain")
    available.push("elevationLoss")
  }
  return available
}

const STAT_PRIORITY: StatKey[] = [
  "distance",
  "duration",
  "elevationGain",
  "avgMovingSpeed",
  "movingTime",
  "elevationLoss",
  "uniqueDistance",
  "avgSpeed",
  "avgPace",
  "avgMovingPace",
]

export function getDefaultStats(s: StatsData): StatKey[] {
  const available = getAvailableStats(s)
  return STAT_PRIORITY.filter((k) => available.includes(k)).slice(0, 4)
}

// ─── Photo → track matching ───────────────────────────────────────────────────

export function filterPhotosForTrack(
  photos: PhotoEntry[],
  track: ParsedTrack
): PhotoEntry[] {
  return photos.filter((p) =>
    track.coordinates.some(
      ([lng, lat]) =>
        Math.abs(lng - p.lng) < 1e-5 && Math.abs(lat - p.lat) < 1e-5
    )
  )
}

export function filterPhotosForTracks(
  photos: PhotoEntry[],
  tracks: ParsedTrack[]
): PhotoEntry[] {
  const seen = new Set<string>()
  const result: PhotoEntry[] = []
  for (const t of tracks) {
    for (const p of filterPhotosForTrack(photos, t)) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        result.push(p)
      }
    }
  }
  return result.sort((a, b) => a.takenAtMs - b.takenAtMs)
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

/** Draw all routes scaled to fit within the upper 65% of the canvas. */
function drawRoutes(
  ctx: CanvasRenderingContext2D,
  tracks: ParsedTrack[],
  W: number,
  H: number
): void {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const t of tracks) {
    for (const [lng, lat] of t.coordinates) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (!isFinite(minLng)) return

  const routeAreaH = H * 0.65
  const PAD = 0.12
  const geoW = maxLng - minLng || 0.001
  const geoH = maxLat - minLat || 0.001
  const availW = W * (1 - 2 * PAD)
  const availH = routeAreaH * (1 - 2 * PAD)
  const scale = Math.min(availW / geoW, availH / geoH)
  const drawnW = geoW * scale
  const drawnH = geoH * scale
  const offsetX = (W - drawnW) / 2
  const offsetY = (routeAreaH - drawnH) / 2
  const toX = (lng: number) => offsetX + (lng - minLng) * scale
  const toY = (lat: number) => offsetY + (maxLat - lat) * scale

  for (const track of tracks) {
    const MAX_PTS = 2000
    const { coordinates } = track
    const step = coordinates.length > MAX_PTS ? Math.ceil(coordinates.length / MAX_PTS) : 1
    const pts = coordinates.filter((_, i) => i % step === 0)
    if (pts.length < 2) continue

    const buildPath = () => {
      ctx.beginPath()
      ctx.moveTo(toX(pts[0][0]), toY(pts[0][1]))
      for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(pts[i][0]), toY(pts[i][1]))
    }

    ctx.save()
    ctx.strokeStyle = `${TRACK_COLOR}50`
    ctx.lineWidth = 22
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.shadowColor = TRACK_COLOR
    ctx.shadowBlur = 30
    buildPath()
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = TRACK_COLOR
    ctx.lineWidth = 7
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    buildPath()
    ctx.stroke()
    ctx.restore()
  }
}

/** Draw the route using pre-projected canvas pixel coordinates (map mode). */
function drawRouteFromPixels(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[]
): void {
  if (points.length < 2) return

  const buildPath = () => {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
  }

  ctx.save()
  ctx.strokeStyle = `${TRACK_COLOR}50`
  ctx.lineWidth = 22
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.shadowColor = TRACK_COLOR
  ctx.shadowBlur = 30
  buildPath()
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = TRACK_COLOR
  ctx.lineWidth = 7
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  buildPath()
  ctx.stroke()
  ctx.restore()
}

function drawImageBackground(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  W: number,
  H: number,
  blurAmount: number,
  darkOverlay: number
): void {
  const scale = Math.max(W / bitmap.width, H / bitmap.height)
  const sw = bitmap.width * scale
  const sh = bitmap.height * scale
  const sx = (W - sw) / 2
  const sy = (H - sh) / 2

  if (blurAmount > 0) {
    const EXT = blurAmount * 2
    ctx.save()
    ctx.filter = `blur(${blurAmount}px)`
    ctx.drawImage(bitmap, sx - EXT, sy - EXT, sw + EXT * 2, sh + EXT * 2)
    ctx.restore()
  } else {
    ctx.drawImage(bitmap, sx, sy, sw, sh)
  }

  ctx.fillStyle = `rgba(10, 10, 30, ${darkOverlay})`
  ctx.fillRect(0, 0, W, H)
}

// ─── Share card ───────────────────────────────────────────────────────────────

export type BackgroundMode = "photo" | "dark" | "map"

export interface ShareCardOptions {
  tracks: ParsedTrack[]
  statsData: StatsData
  enabledStats: StatKey[]
  subtitle: string | null
  photo: PhotoEntry | null
  mapBaseSnapshot: ImageBitmap | null
  mapTrackPointsPerTrack: Array<{ x: number; y: number }[]> | null
  backgroundMode: BackgroundMode
  blurAmount: number
}

export async function drawShareCard(
  canvas: HTMLCanvasElement,
  opts: ShareCardOptions
): Promise<void> {
  await document.fonts.ready

  const {
    tracks,
    statsData,
    enabledStats,
    subtitle,
    photo,
    mapBaseSnapshot,
    mapTrackPointsPerTrack,
    backgroundMode,
    blurAmount,
  } = opts
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const W = canvas.width
  const H = canvas.height

  ctx.clearRect(0, 0, W, H)

  if (backgroundMode === "photo" && photo?.file) {
    const bitmap = await createImageBitmap(photo.file)
    drawImageBackground(ctx, bitmap, W, H, blurAmount, 0.52)
    bitmap.close()
    drawRoutes(ctx, tracks, W, H)
  } else if (backgroundMode === "map" && mapBaseSnapshot) {
    drawImageBackground(ctx, mapBaseSnapshot, W, H, blurAmount, 0.35)
    if (mapTrackPointsPerTrack) {
      for (const pts of mapTrackPointsPerTrack) {
        if (pts.length >= 2) drawRouteFromPixels(ctx, pts)
      }
    }
  } else {
    ctx.fillStyle = FOG_COLOR
    ctx.fillRect(0, 0, W, H)
    if (backgroundMode === "dark") drawRoutes(ctx, tracks, W, H)
  }

  const scrimStart = H * 0.52
  const scrim = ctx.createLinearGradient(0, scrimStart, 0, H)
  scrim.addColorStop(0, "rgba(10, 10, 30, 0)")
  scrim.addColorStop(0.3, "rgba(10, 10, 30, 0.7)")
  scrim.addColorStop(0.55, "rgba(10, 10, 30, 0.88)")
  scrim.addColorStop(1, "rgba(10, 10, 30, 0.96)")
  ctx.fillStyle = scrim
  ctx.fillRect(0, scrimStart, W, H - scrimStart)

  const statCount = Math.min(enabledStats.length, 4)
  const COLS = statCount <= 2 ? 1 : 2
  const ROWS = Math.ceil(statCount / COLS)
  const PAD_X = 80
  const CELL_INNER_PAD = 50
  const CELL_W = (W - PAD_X * 2) / COLS
  const CELL_H = 192
  const BOTTOM_RESERVE = 76
  const STATS_TOP = H - ROWS * CELL_H - BOTTOM_RESERVE

  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
  ctx.lineWidth = 1
  if (COLS === 2) {
    ctx.beginPath()
    ctx.moveTo(W / 2, STATS_TOP - 12)
    ctx.lineTo(W / 2, STATS_TOP + ROWS * CELL_H)
    ctx.stroke()
  }
  if (ROWS === 2) {
    ctx.beginPath()
    ctx.moveTo(PAD_X, STATS_TOP + CELL_H)
    ctx.lineTo(W - PAD_X, STATS_TOP + CELL_H)
    ctx.stroke()
  }

  for (let i = 0; i < statCount; i++) {
    const key = enabledStats[i]
    const def = STAT_DEFS[key]
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const cellX = PAD_X + col * CELL_W + (col > 0 ? CELL_INNER_PAD : 0)
    const cellY = STATS_TOP + row * CELL_H

    ctx.save()
    ctx.font = `700 80px ${FONT_FAMILY}`
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(def.getValue(statsData), cellX, cellY + 106)
    ctx.restore()

    ctx.save()
    ctx.font = `400 27px ${FONT_FAMILY}`
    ctx.fillStyle = "rgba(255, 255, 255, 0.48)"
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(def.unit, cellX, cellY + 152)
    ctx.restore()
  }

  ctx.save()
  ctx.font = `400 19px ${FONT_FAMILY}`
  ctx.fillStyle = "rgba(255, 255, 255, 0.26)"
  ctx.textBaseline = "alphabetic"
  if (subtitle) {
    ctx.textAlign = "left"
    ctx.fillText(subtitle, PAD_X, H - 30)
  }
  ctx.textAlign = "right"
  ctx.fillText("fog-of-walk.mykhailo.net", W - PAD_X, H - 30)
  ctx.restore()
}

// ─── Export / Copy ────────────────────────────────────────────────────────────

export async function copyShareCard(opts: ShareCardOptions): Promise<void> {
  const canvas = document.createElement("canvas")
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  canvas.style.cssText = "position:absolute;left:-9999px;top:-9999px"
  document.body.appendChild(canvas)
  try {
    await drawShareCard(canvas, opts)
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob returned null")); return }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
          resolve()
        } catch (err) { reject(err) }
      }, "image/png")
    })
  } finally {
    document.body.removeChild(canvas)
  }
}

export async function exportShareCard(opts: ShareCardOptions): Promise<void> {
  const canvas = document.createElement("canvas")
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  canvas.style.cssText = "position:absolute;left:-9999px;top:-9999px"
  document.body.appendChild(canvas)
  try {
    await drawShareCard(canvas, opts)
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Canvas toBlob returned null")); return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        const isSingle = opts.tracks.length === 1
        const safeName = isSingle
          ? opts.tracks[0].name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()
          : `${opts.tracks.length}-activities`
        a.href = url
        a.download = `fogofwalk-${safeName || "activity"}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        resolve()
      }, "image/png")
    })
  } finally {
    document.body.removeChild(canvas)
  }
}

// ─── Composite stats (used by TrackStatsPanel) ────────────────────────────────

export interface CompositeStats {
  totalDistanceKm: number
  totalElevationGainM: number
  totalElevationLossM: number
  hasElevation: boolean
  totalDurationMs: number | null
  totalMovingTimeMs: number | null
  avgPaceMinPerKm: number | null
  avgMovingSpeedKmh: number | null
  totalUniqueKm: number
  trackCount: number
}

export function computeCompositeStats(tracks: ParsedTrack[]): CompositeStats {
  let totalDistanceKm = 0
  let totalElevationGainM = 0
  let totalElevationLossM = 0
  let totalDurationMs = 0
  let totalMovingTimeMs = 0
  let timedDistanceKm = 0
  let hasDuration = false
  let hasMovingTime = false
  let hasElevation = false
  let totalUniqueKm = 0

  for (const t of tracks) {
    const s = t.stats
    totalDistanceKm += s?.distanceKm ?? 0
    totalElevationGainM += s?.elevationGainM ?? 0
    totalElevationLossM += s?.elevationLossM ?? 0
    if (s?.hasElevation) hasElevation = true
    if (s?.durationMs != null) { totalDurationMs += s.durationMs; hasDuration = true }
    if (s?.movingTimeMs != null) {
      totalMovingTimeMs += s.movingTimeMs
      timedDistanceKm += s.distanceKm ?? 0
      hasMovingTime = true
    }
    totalUniqueKm += t.stats.uniqueDistanceKm
  }

  const avgPaceMinPerKm =
    hasMovingTime && timedDistanceKm > 0
      ? totalMovingTimeMs / 60000 / timedDistanceKm
      : null
  const avgMovingSpeedKmh =
    hasMovingTime && timedDistanceKm > 0
      ? timedDistanceKm / (totalMovingTimeMs / 3600000)
      : null

  return {
    totalDistanceKm,
    totalElevationGainM,
    totalElevationLossM,
    hasElevation,
    totalDurationMs: hasDuration ? totalDurationMs : null,
    totalMovingTimeMs: hasMovingTime ? totalMovingTimeMs : null,
    avgPaceMinPerKm,
    avgMovingSpeedKmh,
    totalUniqueKm,
    trackCount: tracks.length,
  }
}
