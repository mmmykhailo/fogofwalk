/**
 * Client-side pacing for activity uploads.
 *
 * The server caps uploads per user (`UPLOAD_RATE_MAX_PER_WINDOW` in a
 * `UPLOAD_RATE_WINDOW_MS` window) and rejects the rest with a 429. A bulk
 * import is exactly the workload that hits it, and discovering the limit by
 * failing is expensive: the limiter answers before reading the body, so all
 * three pool workers burn through the remaining queue in milliseconds and every
 * one of those activities waits for a later sync.
 *
 * So this mirrors the server's sliding window locally and waits for a slot
 * instead. The 429 path stays as a fallback for when the two views disagree.
 *
 * State is module-level, not per-run, deliberately: `runSync` re-enters
 * `syncOnce` immediately when a trigger fires mid-run, and a fresh budget there
 * would re-storm a limiter that is already full.
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  UPLOAD_RATE_CLIENT_BUDGET,
  UPLOAD_RATE_WINDOW_MS,
} from "~shared/constants"

declare global {
  interface Window {
    /** Test-only pacing override, installed before the app module loads. */
    __fogofwalkE2eUploadRate?: {
      budget: number
      windowMs: number
    }
  }
}

/**
 * E2E exercises the same pacing path with a tiny window so the regression test
 * does not spend a real minute waiting for a production rate-limit window.
 * The E2E page installs this before the app module loads. Production pages do
 * not, so they retain the shared server limits.
 */
function e2eRateLimitValue(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const e2eUploadRate =
  typeof window === "undefined" ? undefined : window.__fogofwalkE2eUploadRate
const clientUploadRateWindowMs = e2eRateLimitValue(
  e2eUploadRate?.windowMs,
  UPLOAD_RATE_WINDOW_MS
)
const clientUploadRateBudget = e2eRateLimitValue(
  e2eUploadRate?.budget,
  UPLOAD_RATE_CLIENT_BUDGET
)

/** Attempts per activity before the upload is left for the next sync. */
export const MAX_UPLOAD_RETRIES = 3

/**
 * Ceiling on a single server-directed pause. This stays at the server's real
 * window even in E2E: the test-only local pacer is short, while 429 tests need
 * their explicit Retry-After delay to remain observable.
 */
const MAX_UPLOAD_BACKOFF_MS = UPLOAD_RATE_WINDOW_MS

/** Small padding so a slot is genuinely free by the time we wake up. */
const WAKE_MARGIN_MS = 25

/**
 * Shortest hold worth telling the user about.
 *
 * The pacer waits constantly in small increments once the budget is tight;
 * surfacing those would flash a one-second countdown at somebody watching a
 * sync that is in fact progressing normally.
 */
const HOLD_NOTICE_MIN_MS = 2000

/** Send timestamps inside the current window, oldest first. */
const sent: number[] = []
/** Set by a 429: every worker holds off until this passes. */
let penaltyUntil = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Published hold, for the account surfaces ─────────────────────────────────

/**
 * When uploads are expected to resume, if the wait is long enough to explain.
 *
 * Separate from `penaltyUntil` because the two answer different questions: that
 * one is *why the 429 path sleeps*, this one is *what to tell the user*. The
 * commonest long hold is not a 429 at all — it is the pacer, which spends the
 * whole first burst of a large import and then waits out a full window.
 */
let noticeUntil = 0

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getNoticeUntil(): number {
  return noticeUntil
}

/** Publish a hold, if it is long enough to be worth a line of UI. */
function announceHold(resumeAt: number): void {
  if (resumeAt - Date.now() < HOLD_NOTICE_MIN_MS) return
  if (resumeAt <= noticeUntil) return
  noticeUntil = resumeAt
  for (const listener of listeners) listener()
}

/**
 * Resolve once this upload fits inside the budget.
 *
 * The timestamp is pushed synchronously before any await, so the concurrent
 * pool workers cannot both see the same free slot.
 */
export async function acquireUploadSlot(): Promise<void> {
  for (;;) {
    const now = Date.now()

    if (now < penaltyUntil) {
      announceHold(penaltyUntil)
      await sleep(penaltyUntil - now)
      continue
    }

    const cutoff = now - clientUploadRateWindowMs
    while (sent.length > 0 && sent[0] <= cutoff) sent.shift()

    if (sent.length < clientUploadRateBudget) {
      sent.push(now)
      return
    }

    // Full. The oldest send is the first to leave the window — and because a
    // fresh page spends its whole budget in one burst, that first wait is very
    // nearly the entire window. Announcing it is the difference between a
    // countdown and a minute of "Syncing 108 of 195…" with nothing moving.
    const resumeAt = sent[0] + clientUploadRateWindowMs
    announceHold(resumeAt)
    await sleep(resumeAt - now + WAKE_MARGIN_MS)
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
  penaltyUntil = Math.max(penaltyUntil, Date.now() + wait)
  // Our view of the window was wrong, and the server has just told us when it
  // next has room. Start counting again from there rather than carrying
  // estimates we know to be bad.
  sent.length = 0
  announceHold(penaltyUntil)
}

/**
 * Wait before attempt `attempt` (0-based) when a 429 arrived without a stated
 * delay — an intermediary, or an older server. 1 s, 2 s, 4 s.
 */
export function fallbackBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_UPLOAD_BACKOFF_MS)
}

/**
 * Whole seconds until uploads resume, or `null` when nothing is holding them.
 *
 * `noticeUntil` is a fixed instant, so subscribing to it alone would render the
 * countdown once and leave it frozen. The interval is what makes it tick, and it
 * stops itself at zero rather than re-rendering forever.
 */
export function useUploadHoldSeconds(): number | null {
  const holdUntil = useSyncExternalStore(
    subscribe,
    getNoticeUntil,
    getNoticeUntil
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (holdUntil <= Date.now()) return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (tick >= holdUntil) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [holdUntil])

  const remainingMs = holdUntil - now
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null
}
