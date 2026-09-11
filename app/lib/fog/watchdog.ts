export const DEFAULT_FOG_WORKER_TIMEOUT_MS = 30_000

export interface FogWorkerWatchdogRequest {
  requestId: string
  generation: number
}

export interface FogWorkerWatchdogOptions {
  timeoutMs?: number
  now?: () => number
  onTimeout: (request: FogWorkerWatchdogRequest) => void
}

export interface FogWorkerWatchdog {
  /**
   * Observe the active request. Repeated observations refresh the deadline by
   * default; polling can pass false when it is only checking for a timeout.
   */
  observe(request: FogWorkerWatchdogRequest | null, refresh?: boolean): void
  check(now?: number): boolean
  readonly activeRequest: FogWorkerWatchdogRequest | null
}

/**
 * Small deterministic timeout state machine for a request that has no reply.
 * The bridge owns the polling timer; this closure owns request replacement and
 * elapsed-time accounting so tests do not need a real Worker or wall clock.
 */
export function createFogWorkerWatchdog(
  options: FogWorkerWatchdogOptions
): FogWorkerWatchdog {
  const timeoutMs = Math.max(
    1,
    Math.floor(options.timeoutMs ?? DEFAULT_FOG_WORKER_TIMEOUT_MS)
  )
  const now = options.now ?? (() => Date.now())
  const onTimeout = options.onTimeout
  let active: {
    request: FogWorkerWatchdogRequest
    startedAt: number
  } | null = null

  function observe(
    request: FogWorkerWatchdogRequest | null,
    refresh = true
  ): void {
    if (!request) {
      active = null
      return
    }
    if (
      active?.request.requestId === request.requestId &&
      active.request.generation === request.generation
    ) {
      if (refresh) active.startedAt = now()
      return
    }
    active = { request, startedAt: now() }
  }

  function check(at = now()): boolean {
    if (!active || at - active.startedAt < timeoutMs) {
      return false
    }
    const request = active.request
    active = null
    onTimeout(request)
    return true
  }

  return {
    observe,
    check,
    get activeRequest() {
      return active?.request ?? null
    },
  }
}
