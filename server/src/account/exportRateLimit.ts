const EXPORT_RATE_WINDOW_MS = 15 * 60_000
const EXPORT_RATE_MAX = 1
const EXPORT_RETRY_FALLBACK_MS = 60_000

const hits = new Map<string, number[]>()

export type ExportRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number }

export function checkExportRateLimit(
  userId: string,
  now: number = Date.now()
): ExportRateLimitResult {
  const cutoff = now - EXPORT_RATE_WINDOW_MS
  const recent = (hits.get(userId) ?? []).filter((at) => at > cutoff)

  if (recent.length >= EXPORT_RATE_MAX) {
    hits.set(userId, recent)
    const oldest = recent[0]
    return {
      ok: false,
      retryAfterMs: oldest
        ? Math.max(1, oldest + EXPORT_RATE_WINDOW_MS - now)
        : EXPORT_RETRY_FALLBACK_MS,
    }
  }

  recent.push(now)
  hits.set(userId, recent)

  if (hits.size > 1000) {
    for (const [key, times] of hits) {
      if (times.every((at) => at <= cutoff)) hits.delete(key)
    }
  }

  return { ok: true }
}

export function resetExportRateLimit(): void {
  hits.clear()
}
