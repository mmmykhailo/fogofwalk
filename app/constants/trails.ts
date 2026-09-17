// Keep production disabled until the Waymarked Trails permission and
// performance gates have been reviewed for the production origin. The local
// E2E build may opt in with VITE_TRAILS_FEATURE_ENABLED while public hosts are
// still blocked or fulfilled by synthetic fixtures.
export const TRAILS_FEATURE_ENABLED =
  import.meta.env.VITE_TRAILS_FEATURE_ENABLED === "true"
export const TRAILS_VISIBLE_DEFAULT = true

export const TRAIL_PROTOCOL_NAME = "fow-trails"
export const TRAIL_SOURCE_LAYER = "trails"
export const TRAIL_DATA_ZOOM = 12
export const TRAIL_MIN_RENDER_ZOOM = 12
export const TRAIL_MAX_RENDER_ZOOM = 24

export const TRAIL_THEMES = ["hiking", "cycling"] as const

export const TRAIL_PROVIDER_BASE_URLS = {
  hiking: "https://hiking.waymarkedtrails.org/api/v1/tiles",
  cycling: "https://cycling.waymarkedtrails.org/api/v1/tiles",
} as const

export const TRAIL_PROVIDER_HOSTNAMES = [
  "hiking.waymarkedtrails.org",
  "cycling.waymarkedtrails.org",
] as const
export const TRAIL_PROVIDER_TILE_PATH_PREFIX = `/api/v1/tiles/${TRAIL_DATA_ZOOM}/`

export const TRAIL_INTERNAL_TILE_URLS = {
  hiking: "fow-trails://hiking/{z}/{x}/{y}",
  cycling: "fow-trails://cycling/{z}/{x}/{y}",
} as const

export const TRAIL_SOURCE_IDS = {
  hiking: "trails-hiking-source",
  cycling: "trails-cycling-source",
} as const
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
export const REVERSE_TRAIL_LAYER_IDS = [
  ...ORDERED_TRAIL_LAYER_IDS,
].reverse() as unknown as readonly [
  typeof TRAIL_LAYER_IDS.cycling,
  typeof TRAIL_LAYER_IDS.hiking,
  typeof TRAIL_LAYER_IDS.hikingCasing,
]
export const ORDERED_TRAIL_SOURCE_IDS = [
  TRAIL_SOURCE_IDS.hiking,
  TRAIL_SOURCE_IDS.cycling,
] as const

export const TRAIL_PROVIDER_ATTRIBUTION =
  '<a href="https://waymarkedtrails.org/" target="_blank">Trails © Waymarked Trails (CC BY-SA 3.0 DE)</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'

export const TRAIL_FETCH_TIMEOUT_MS = 15_000
export const TRAIL_MAX_RESPONSE_BYTES = 4_000_000
export const TRAIL_MAX_FEATURES_PER_TILE = 10_000
export const TRAIL_MAX_COORDINATES_PER_FEATURE = 50_000
export const TRAIL_MAX_COORDINATES_PER_TILE = 250_000
export const TRAIL_MAX_PARALLEL_COLORS = 4

export const WEB_MERCATOR_RADIUS_METERS = 6_378_137
export const WEB_MERCATOR_WORLD_LIMIT_METERS = 20_037_508.342789244
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066
export const WEB_MERCATOR_BOUND_TOLERANCE_METERS = 1

export const TRAIL_PROVIDER_WAY_TYPE = "way"
export const TRAIL_KCT_SHIELD_PATTERN =
  /^kct_(?:int|nat|reg|loc)_(red|green|blue|yellow)-[a-z0-9_]+$/i
export const TRAIL_HIKING_COLORS = {
  red: "#d9272e",
  green: "#15803d",
  blue: "#1769aa",
  yellow: "#eab308",
} as const
export const TRAIL_HIKING_COLOR_ORDER = [
  "red",
  "green",
  "blue",
  "yellow",
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

export const TRAIL_CACHE_NAME = "trail-data-tiles-v1"
export const TRAIL_CACHE_MAX_ENTRIES = 300
export const TRAIL_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
export const TRAIL_DIAGNOSTIC_STAGE = "trail_tile"
export const TRAIL_DIAGNOSTIC_OPERATION_IDS = {
  protocol: "trail:protocol",
  hiking: "trail:hiking",
  cycling: "trail:cycling",
} as const
