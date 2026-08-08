/**
 * Per-user sliding-window limiter for uploads.
 *
 * In-process on purpose: it protects one server's disk and CPU from a runaway
 * client, not from a distributed attacker. A multi-instance deployment would
 * move this behind a shared store — see the note in README.md.
 */

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 120

const hits = new Map<string, number[]>()

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  windowMs: number = WINDOW_MS,
  maxPerWindow: number = MAX_PER_WINDOW
): boolean {
  const cutoff = now - windowMs
  const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)

  if (recent.length >= maxPerWindow) {
    hits.set(key, recent)
    return false
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

  return true
}

export function resetRateLimits(): void {
  hits.clear()
}
