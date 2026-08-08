/** Limits and timings agreed between the browser app and the sync server. */

/** Largest accepted gzipped track upload. Rejected with 413 above this. */
export const MAX_TRACK_BYTES = 8 * 1024 * 1024

/** Manifest rows returned per page. The client follows `hasMore` until dry. */
export const SYNC_PAGE_SIZE = 500

/** Session lifetime. The client treats an expired token as signed out. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Lifetime of the single-use code handed to the client after OAuth. Short
 * because it travels in a URL; the long-lived token never does.
 */
export const HANDOFF_TTL_MS = 60 * 1000

/** In-flight track uploads/downloads the sync engine allows at once. */
export const SYNC_CONCURRENCY = 3

/** Coordinate precision used when building the content hash (~0.1 m). */
export const HASH_COORD_PRECISION = 6
