const MAX_IN_FLIGHT_EXPORTS = 2
const RETRY_AFTER_MS = 1_000

export interface ExportConcurrencyGate {
  acquire(): (() => void) | null
  reset(): void
}

export function createExportConcurrencyGate(
  maxInFlight = MAX_IN_FLIGHT_EXPORTS
): ExportConcurrencyGate {
  let inFlight = 0

  return {
    acquire() {
      if (inFlight >= maxInFlight) return null
      inFlight += 1
      let released = false

      return () => {
        if (released) return
        released = true
        inFlight -= 1
      }
    },
    reset() {
      inFlight = 0
    },
  }
}

export const exportOverloadRetryAfterMs = RETRY_AFTER_MS
const exportConcurrencyGate = createExportConcurrencyGate()

export function acquireExportSlot(): (() => void) | null {
  return exportConcurrencyGate.acquire()
}

export function resetExportConcurrency(): void {
  exportConcurrencyGate.reset()
}
