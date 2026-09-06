/** Limits and timings agreed between the browser app and the sync server. */

/** Largest accepted gzipped activity upload. Rejected with 413 above this. */
export const MAX_ACTIVITY_BYTES = 8 * 1024 * 1024

/** Manifest rows returned per page. The client follows `hasMore` until dry. */
export const SYNC_PAGE_SIZE = 500

/** Maximum activity cards returned from the anonymous public-profile endpoint. */
export const PUBLIC_ACTIVITY_PAGE_SIZE = 48

/** Fixed-size overview previews keep a profile response independent of library size. */
export const PUBLIC_PROFILE_RECENT_ACTIVITY_LIMIT = 4
export const PUBLIC_PROFILE_SAVED_POINT_LIMIT = 4
export const PUBLIC_PROFILE_WEEKLY_BAR_LIMIT = 26

/** Session lifetime. The client treats an expired token as signed out. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Lifetime of the single-use code handed to the client after OAuth. Short
 * because it travels in a URL; the long-lived token never does.
 */
export const HANDOFF_TTL_MS = 60 * 1000

/** In-flight activity uploads/downloads the sync engine allows at once. */
export const SYNC_CONCURRENCY = 3

/** The server's per-user upload window (`PUT /api/activities/:contentHash`). */
export const UPLOAD_RATE_WINDOW_MS = 60_000
export const UPLOAD_RATE_MAX_PER_WINDOW = 120

/**
 * What the client allows itself inside that window.
 *
 * Deliberately below the server's number: the two windows are measured at
 * opposite ends of the request, so the client's view always drifts slightly
 * ahead of the server's. The margin is what keeps an ordinary bulk import from
 * discovering the limit by failing.
 */
export const UPLOAD_RATE_CLIENT_BUDGET = 108

/** Coordinate precision used when building the content hash (~0.1 m). */
export const HASH_COORD_PRECISION = 6
