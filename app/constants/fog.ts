export const FOG_CLEAR_RADIUS_METERS = 100
export const FOG_EMIT_INTERVAL_MS = 300
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
export const FOG_COLOR = "#0a0a1e"
export const FOG_OPACITY = 0.8
export const TRACK_COLOR = "#ff6b35"
// Tolerance for the emitted fog polygon (controls fog-edge visual precision).
// ~11 m at equator — invisible at any normal map zoom level.
export const SIMPLIFY_TOLERANCE = 0.0001
// Tolerance for track simplification *before* buffering.
// Can be much larger than SIMPLIFY_TOLERANCE: the 100 m buffer hides any
// corner-cutting up to ~50 m, so this does not affect the visual fog boundary.
export const TRACK_SIMPLIFY_TOLERANCE = 0.0005
// Number of arc segments used to approximate curves in the 100 m buffer.
// Default (64) produces ~39,000° spacing (~10 m arcs at 100 m radius) — far more
// precision than needed. 16 steps gives ~39 m arcs, indistinguishable at zoom ≤ 16,
// and reduces each buffer polygon's vertex count by 4×.
export const BUFFER_STEPS = 16
export const TRACK_WIDTH_DEFAULT = 2
export const TRACK_WIDTH_SELECTED = 4
export const TRACK_OPACITY_DEFAULT = 0.85
export const TRACK_OPACITY_SELECTED = 1.0
export const TRACK_OPACITY_DIM = 0.35
export const MOVING_TIME_STOPPED_GAP_MS = 180_000
export const MOVING_TIME_MIN_SPEED_KMH = 0.5
// Elevation gain/loss normalizer: raw point-to-point elevation deltas are
// dominated by GPS/barometric noise, wildly overstating total ascent/descent.
// We smooth the elevation series with a distance-windowed moving average
// (so the result is independent of the track's sampling frequency), then only
// count a gain/loss "step" once the smoothed trace has drifted past a
// threshold from the last reference point (hysteresis step filter).
export const ELEVATION_SMOOTHING_DISTANCE_M = 15
export const ELEVATION_GAIN_STEP_THRESHOLD_M = 2
