const MAX_IN_FLIGHT_EXPORTS = 2
const RETRY_AFTER_MS = 1_000

let inFlight = 0

export function acquireExportSlot(): (() => void) | null {
  if (inFlight >= MAX_IN_FLIGHT_EXPORTS) return null
  inFlight += 1
  let released = false

  return () => {
    if (released) return
    released = true
    inFlight -= 1
  }
}

export const exportOverloadRetryAfterMs = RETRY_AFTER_MS

export function resetExportConcurrency(): void {
  inFlight = 0
}
