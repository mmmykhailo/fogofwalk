/**
 * The upload limiter itself.
 *
 * Every other suite only calls `resetRateLimits()` to keep this module out of
 * the way, so nothing covered the window arithmetic. That matters now: the
 * client paces itself against the same constants and uses `retryAfterMs` to
 * decide how long to hold every in-flight upload, so a wrong number here stalls
 * or storms a sync rather than just logging a warning.
 */

import { describe, expect, test, beforeEach } from "bun:test"

import { UPLOAD_RATE_MAX_PER_WINDOW } from "~shared/constants"

import { checkRateLimit, resetRateLimits } from "../src/tracks/rateLimit"

const WINDOW = 1000
const MAX = 3

beforeEach(() => {
  resetRateLimits()
})

describe("checkRateLimit", () => {
  test("allows up to the cap, then rejects", () => {
    const now = 10_000
    for (let i = 0; i < MAX; i++) {
      expect(checkRateLimit("u1", now + i, WINDOW, MAX).ok).toBe(true)
    }
    expect(checkRateLimit("u1", now + MAX, WINDOW, MAX).ok).toBe(false)
  })

  test("retryAfterMs points at when the oldest hit leaves the window", () => {
    // Three hits at t=0, 100, 200 with a 1000 ms window. At t=500 the window is
    // full and the earliest free slot is when the t=0 hit expires: t=1000.
    checkRateLimit("u1", 0, WINDOW, MAX)
    checkRateLimit("u1", 100, WINDOW, MAX)
    checkRateLimit("u1", 200, WINDOW, MAX)

    const result = checkRateLimit("u1", 500, WINDOW, MAX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a rejection")
    expect(result.retryAfterMs).toBe(500)
  })

  test("a rejected request does not extend the block", () => {
    for (let i = 0; i < MAX; i++) checkRateLimit("u1", i, WINDOW, MAX)

    // Hammer while blocked. If a rejection recorded a hit, the wait would keep
    // sliding forward and a client honouring it would never get back in.
    for (let t = 500; t < 900; t += 100) {
      expect(checkRateLimit("u1", t, WINDOW, MAX).ok).toBe(false)
    }

    // The oldest hit (t=0) expires at t=1000 regardless of the hammering.
    expect(checkRateLimit("u1", 1001, WINDOW, MAX).ok).toBe(true)
  })

  test("the window slides rather than resetting", () => {
    for (let i = 0; i < MAX; i++) checkRateLimit("u1", i * 100, WINDOW, MAX)
    // t=0 has expired by t=1050, freeing exactly one slot — not the whole window.
    expect(checkRateLimit("u1", 1050, WINDOW, MAX).ok).toBe(true)
    expect(checkRateLimit("u1", 1051, WINDOW, MAX).ok).toBe(false)
  })

  test("keys are independent", () => {
    for (let i = 0; i < MAX; i++) checkRateLimit("u1", i, WINDOW, MAX)
    expect(checkRateLimit("u1", MAX, WINDOW, MAX).ok).toBe(false)
    expect(checkRateLimit("u2", MAX, WINDOW, MAX).ok).toBe(true)
  })

  test("sweeps stale keys once the map grows past the threshold", () => {
    // 1001 one-shot users, then one call a full window later: the sweep runs
    // and drops every entry whose hits have all expired.
    for (let i = 0; i <= 1000; i++) checkRateLimit(`u${i}`, 0, WINDOW, MAX)
    checkRateLimit("fresh", WINDOW * 2, WINDOW, MAX)

    // If the sweep had not run, `u0` would still hold its t=0 hit. It is gone,
    // so a full window's worth of budget is available again.
    for (let i = 0; i < MAX; i++) {
      expect(checkRateLimit("u0", WINDOW * 2 + i, WINDOW, MAX).ok).toBe(true)
    }
  })

  test("defaults to the shared client/server budget", () => {
    const now = 5_000
    for (let i = 0; i < UPLOAD_RATE_MAX_PER_WINDOW; i++) {
      expect(checkRateLimit("u1", now).ok).toBe(true)
    }
    expect(checkRateLimit("u1", now).ok).toBe(false)
  })
})
