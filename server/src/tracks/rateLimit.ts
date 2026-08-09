/**
 * Per-user sliding-window limiter for uploads.
 *
 * In-process on purpose: it protects one server's disk and CPU from a runaway
 * client, not from a distributed attacker. A multi-instance deployment would
 * move this behind a shared store — see the note in README.md.
 *
 * The window and the cap live in `shared/constants.ts` because the client
 * paces itself against the same numbers. A rejection is a fallback, not the
 * mechanism.
 */

import {
  UPLOAD_RATE_MAX_PER_WINDOW,
  UPLOAD_RATE_WINDOW_MS,
} from "~shared/constants"

const hits = new Map<string, number[]>()

/**
 * Rejected requests carry how long the caller must wait, so the client can
 * pause every in-flight worker until the window has actually drained instead
 * of guessing.
 */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number }

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  windowMs: number = UPLOAD_RATE_WINDOW_MS,
  maxPerWindow: number = UPLOAD_RATE_MAX_PER_WINDOW
): RateLimitResult {
  const cutoff = now - windowMs
  const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)

  if (recent.length >= maxPerWindow) {
    hits.set(key, recent)
    // The oldest hit is the first to leave the window, so that is the earliest
    // moment a slot frees. Not pushing `now` is deliberate: hammering must not
    // extend the block.
    const oldest = recent[0] ?? cutoff + windowMs
    return { ok: false, retryAfterMs: Math.max(1, oldest - cutoff) }
  }

  recent.push(now)
  hits.set(key, recent)

  // Opportunistic sweep so a long-lived process does not accumulate an entry
  // per user who uploaded once.
  if (hits.size > 1000) {
    for (const [entryKey, times] of hits) {
      if (times.every((at) => at <= cutoff)) hits.delete(entryKey)
    }
  }

  return { ok: true }
}

export function resetRateLimits(): void {
  hits.clear()
}
