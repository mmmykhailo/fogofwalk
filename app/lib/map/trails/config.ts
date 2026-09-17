/**
 * Validate the public, read-only trail archive configured for this client.
 *
 * HTTP is intentionally limited to loopback so local fixture servers can be
 * used in tests without making an insecure production configuration possible.
 */
export function validateTrailArchiveUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (url.username || url.password || url.search || url.hash) return null
  if (!url.pathname.toLowerCase().endsWith(".pmtiles")) return null

  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    return null
  }

  return url.href
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  )
}

const rawTrailArchiveUrl = import.meta.env.VITE_TRAIL_ARCHIVE_URL as
  | string
  | undefined

/** Absolute archive URL compiled into this client, or null when unavailable. */
export const TRAIL_ARCHIVE_URL = validateTrailArchiveUrl(rawTrailArchiveUrl)
