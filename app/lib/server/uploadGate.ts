/**
 * Client-side pacing for track uploads.
 *
 * The server caps uploads per user (`UPLOAD_RATE_MAX_PER_WINDOW` in a
 * `UPLOAD_RATE_WINDOW_MS` window) and rejects the rest with a 429. A bulk
 * import is exactly the workload that hits it, and discovering the limit by
 * failing is expensive: the limiter answers before reading the body, so all
 * three pool workers burn through the remaining queue in milliseconds and every
 * one of those tracks waits for a later sync.
 *
 * So this mirrors the server's sliding window locally and waits for a slot
 * instead. The 429 path stays as a fallback for when the two views disagree.
 *
 * State is module-level, not per-run, deliberately: `runSync` re-enters
 * `syncOnce` immediately when a trigger fires mid-run, and a fresh budget there
 * would re-storm a limiter that is already full.
 */

import {
  UPLOAD_RATE_CLIENT_BUDGET,
  UPLOAD_RATE_WINDOW_MS,
} from "~shared/constants"

/** Attempts per track before the upload is left for the next sync. */
export const MAX_UPLOAD_RETRIES = 3

/**
 * Ceiling on a single pause. The server's own wait can never exceed its window,
 * so anything longer is a proxy or a misconfiguration and should not park the
 * whole sync behind it.
 */
const MAX_UPLOAD_BACKOFF_MS = UPLOAD_RATE_WINDOW_MS

/** Small padding so a slot is genuinely free by the time we wake up. */
const WAKE_MARGIN_MS = 25

/** Send timestamps inside the current window, oldest first. */
const sent: number[] = []
/** Set by a 429: every worker holds off until this passes. */
let pausedUntil = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolve once this upload fits inside the budget.
 *
 * The timestamp is pushed synchronously before any await, so the concurrent
 * pool workers cannot both see the same free slot.
 */
export async function acquireUploadSlot(): Promise<void> {
  for (;;) {
    const now = Date.now()

    if (now < pausedUntil) {
      await sleep(pausedUntil - now)
      continue
    }

    const cutoff = now - UPLOAD_RATE_WINDOW_MS
    while (sent.length > 0 && sent[0] <= cutoff) sent.shift()

    if (sent.length < UPLOAD_RATE_CLIENT_BUDGET) {
      sent.push(now)
      return
    }

    // Full. The oldest send is the first to leave the window.
    await sleep(sent[0] - cutoff + WAKE_MARGIN_MS)
  }
}

/**
 * Record that the server rejected an upload, and hold *every* worker off until
 * `retryAfterMs` has passed.
 *
 * Pausing collectively is the point. Backing off per-request would leave the
 * other workers hammering a limiter that has already tripped, which is the
 * behaviour this replaces.
 */
export function penalizeUploads(retryAfterMs: number): void {
  const wait = Math.min(Math.max(retryAfterMs, 0), MAX_UPLOAD_BACKOFF_MS)
  pausedUntil = Math.max(pausedUntil, Date.now() + wait)
  // Our view of the window was wrong, and the server has just told us when it
  // next has room. Start counting again from there rather than carrying
  // estimates we know to be bad.
  sent.length = 0
}

/**
 * Wait before attempt `attempt` (0-based) when a 429 arrived without a stated
 * delay — an intermediary, or an older server. 1 s, 2 s, 4 s.
 */
export function fallbackBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_UPLOAD_BACKOFF_MS)
}

/** Test seam: drop all pacing state. */
export function resetUploadGate(): void {
  sent.length = 0
  pausedUntil = 0
}
