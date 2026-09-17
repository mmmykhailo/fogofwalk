export const TRAILS_VISIBLE_DEFAULT = true

export const TRAIL_TILEJSON_URL = "https://tiles.maptoolkit.org/mtk.json"
export const TRAIL_SOURCE_LAYER = "road"
export const TRAIL_MIN_RENDER_ZOOM = 7
export const TRAIL_MAX_RENDER_ZOOM = 24

export const TRAIL_WALKING_NETWORKS = ["iwn", "nwn", "rwn", "lwn"] as const
export const TRAIL_CYCLING_NETWORKS = ["icn", "ncn", "rcn", "lcn"] as const

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

export const TRAIL_HIKING_CASING_COLOR = "rgba(255, 255, 255, 0.82)"
export const TRAIL_HIKING_COLOR = "#3b82f6"
export const TRAIL_HIKING_DASH_ARRAY = [3, 2] as const
export const TRAIL_HIKING_OPACITY = 0.92
export const TRAIL_HIKING_CASING_OPACITY = 0.82
export const TRAIL_HIKING_WIDTH_STOPS = [
  7, 1.2, 12, 2, 15, 3.2, 20, 5.2,
] as const
export const TRAIL_HIKING_CASING_WIDTH_DELTA = 1.8

export const TRAIL_CYCLING_COLOR = "#4cb056"
export const TRAIL_CYCLING_OPACITY = 0.95
export const TRAIL_CYCLING_WIDTH_STOPS = [
  7, 1.4, 12, 2.2, 15, 3.4, 20, 5.4,
] as const
export const TRAIL_CYCLING_DASH_ARRAY = [2, 2] as const

export const TRAIL_LINE_CAP = "round" as const
export const TRAIL_LINE_JOIN = "round" as const

export const TRAIL_DIAGNOSTIC_STAGE = "trail_tiles"
export const TRAIL_DIAGNOSTIC_OPERATION_IDS = {
  tiles: "trail:tiles",
} as const
