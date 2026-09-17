export const TRAILS_VISIBLE_DEFAULT = true

export const TRAIL_SOURCE_LAYER = "trails"
export const TRAIL_DATA_ZOOM = 12
export const TRAIL_MIN_RENDER_ZOOM = 12
export const TRAIL_MAX_RENDER_ZOOM = 24

export const TRAIL_THEMES = ["hiking", "cycling"] as const

export const TRAIL_SOURCE_ID = "trails-source"
export const TRAIL_LAYER_IDS = {
  hikingCasing: "trails-hiking-casing-layer",
  hiking: "trails-hiking-layer",
  cycling: "trails-cycling-layer",
} as const
export const ORDERED_TRAIL_LAYER_IDS = [
  TRAIL_LAYER_IDS.hikingCasing,
  TRAIL_LAYER_IDS.hiking,
  TRAIL_LAYER_IDS.cycling,
] as const
export const REVERSE_TRAIL_LAYER_IDS = [...ORDERED_TRAIL_LAYER_IDS].reverse()
export const ORDERED_TRAIL_SOURCE_IDS = [TRAIL_SOURCE_ID] as const

export const TRAIL_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'

export const TRAIL_HIKING_COLORS = {
  red: "#d9272e",
  green: "#15803d",
  blue: "#1769aa",
  yellow: "#eab308",
  orange: "#ea580c",
  purple: "#7e22ce",
  black: "#262626",
  brown: "#854d0e",
} as const
export const TRAIL_HIKING_COLOR_ORDER = [
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "black",
  "brown",
] as const
export const TRAIL_HIKING_FALLBACK_COLOR = "#7e22ce"
export const TRAIL_HIKING_CASING_COLOR = "rgba(255, 255, 255, 0.82)"
export const TRAIL_HIKING_OPACITY = 0.92
export const TRAIL_HIKING_CASING_OPACITY = 0.82
export const TRAIL_HIKING_WIDTH_STOPS = [
  12, 2, 14, 2.8, 17, 4.2, 20, 5.2,
] as const
export const TRAIL_HIKING_CASING_WIDTH_DELTA = 1.8
export const TRAIL_PARALLEL_LINE_SEPARATION_PX = 3
export const TRAIL_HIKING_SORT_ORDER = 10

export const TRAIL_CYCLING_COLOR = "#ec4899"
export const TRAIL_CYCLING_OPACITY = 0.95
export const TRAIL_CYCLING_WIDTH_STOPS = [
  12, 2.2, 14, 3, 17, 4.4, 20, 5.4,
] as const
export const TRAIL_CYCLING_DASH_ARRAY = [2, 2] as const
export const TRAIL_CYCLING_SORT_ORDER = 20

export const TRAIL_LINE_CAP = "round" as const
export const TRAIL_LINE_JOIN = "round" as const

export const TRAIL_DIAGNOSTIC_STAGE = "trail_archive"
export const TRAIL_DIAGNOSTIC_OPERATION_IDS = {
  archive: "trail:archive",
} as const
