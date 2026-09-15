import { vi } from "vitest"

export const FIXTURE_NOW_MS = Date.parse("2026-09-15T12:00:00.000Z")
export const FIXTURE_NOW = new Date(FIXTURE_NOW_MS)

export function fixtureDate(offsetDays = 0): Date {
  return new Date(FIXTURE_NOW_MS + offsetDays * 86_400_000)
}

/** Run a callback with the clock fixed to the shared fixture instant. */
export function withFixtureTime<T>(callback: () => T): T {
  vi.useFakeTimers()
  vi.setSystemTime(FIXTURE_NOW_MS)
  try {
    return callback()
  } finally {
    vi.useRealTimers()
  }
}
