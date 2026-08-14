// ─── Relative time formatting ─────────────────────────────────────────────────
// Shared across any UI that shows "when did this happen" (track cards, activity
// lists, …). Calendar-day based, not a rolling 24h window, so "today"/"yesterday"
// match what the user would call them regardless of what time of day it is.

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/**
 * Formats a timestamp relative to `now`, e.g. "today at 18:15",
 * "yesterday at 00:03", "5 days ago", "a week ago", "2 weeks ago",
 * "a month ago", "2 months ago", "1 year ago", "2 years ago".
 */
export function formatRelativeTime(
  ms: number,
  now: number = Date.now()
): string {
  const dayDiff = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)

  if (dayDiff <= 0) return `today at ${formatClockTime(ms)}`
  if (dayDiff === 1) return `yesterday at ${formatClockTime(ms)}`
  if (dayDiff < 7) return `${dayDiff} days ago`

  if (dayDiff < 28) {
    const weeks = Math.round(dayDiff / 7)
    return weeks <= 1 ? "a week ago" : `${weeks} weeks ago`
  }

  if (dayDiff < 365) {
    const months = Math.round(dayDiff / 30)
    return months <= 1 ? "a month ago" : `${months} months ago`
  }

  const years = Math.round(dayDiff / 365)
  return `${years} year${years === 1 ? "" : "s"} ago`
}
