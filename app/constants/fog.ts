export const FOG_CLEAR_RADIUS_METERS = 100
export const FOG_EMIT_INTERVAL_MS = 300
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
export const FOG_COLOR = "#0a0a1e"
export const FOG_OPACITY = 0.8
export const ACTIVITY_COLOR = "#ff6b35"
// Tolerance for the emitted fog polygon (controls fog-edge visual precision).
// ~11 m at equator — invisible at any normal map zoom level.
export const SIMPLIFY_TOLERANCE = 0.0001
// Tolerance for activity simplification *before* buffering.
// Can be much larger than SIMPLIFY_TOLERANCE: the 100 m buffer hides any
// corner-cutting up to ~50 m, so this does not affect the visual fog boundary.
export const ACTIVITY_SIMPLIFY_TOLERANCE = 0.0005
// Number of arc segments used to approximate curves in the 100 m buffer.
// Default (64) produces ~39,000° spacing (~10 m arcs at 100 m radius) — far more
// precision than needed. 16 steps gives ~39 m arcs, indistinguishable at zoom ≤ 16,
// and reduces each buffer polygon's vertex count by 4×.
export const BUFFER_STEPS = 16
export const ACTIVITY_WIDTH_DEFAULT = 2
export const ACTIVITY_WIDTH_SELECTED = 4
export const ACTIVITY_OPACITY_DEFAULT = 0.85
export const ACTIVITY_OPACITY_SELECTED = 1.0
export const ACTIVITY_OPACITY_DIM = 0.35
// Colour of unselected activities while something is selected. Blue-tinted gray so
// it sits between the navy fog and the light basemap and stays legible on both
// the flat and satellite styles, leaving ACTIVITY_COLOR as the only saturated hue.
export const ACTIVITY_COLOR_DIM = "#8b8b9e"
// Width (px) of the invisible line layer used for click/tap hit-testing —
// wider than the visible activity line so it's easier to select on touch screens.
export const ACTIVITY_HIT_WIDTH = 24
export const MOVING_TIME_STOPPED_GAP_MS = 180_000
export const MOVING_TIME_MIN_SPEED_KMH = 0.5
// Elevation gain/loss normalizer: raw point-to-point elevation deltas are
// dominated by GPS/barometric noise, wildly overstating total ascent/descent.
// We smooth the elevation series with a distance-windowed moving average
// (so the result is independent of the activity's sampling frequency), then only
// count a gain/loss "step" once the smoothed trace has drifted past a
// threshold from the last reference point (hysteresis step filter).
export const ELEVATION_SMOOTHING_DISTANCE_M = 15
export const ELEVATION_GAIN_STEP_THRESHOLD_M = 2

// Laps. An activity's own elevation profile is capped at 300 points; laps get a
// much smaller cap because an auto-lap run can have dozens of them and every
// one is structured-cloned into IndexedDB and re-cloned into the fog worker on
// each reprocess. MAX_LAPS is a sanity bound against pathological files.
export const LAP_PROFILE_POINTS = 60
export const MAX_LAPS = 200
// Width of the highlight line drawn over the selected lap.
export const LAP_HIGHLIGHT_WIDTH = 6
