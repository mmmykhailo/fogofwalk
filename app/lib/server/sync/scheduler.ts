export interface SyncSchedulerOptions {
  execute: (reason: string) => Promise<void>
  acquireLeadership?: (run: () => Promise<void>) => Promise<boolean>
  enabled?: () => boolean
  onError?: (error: unknown) => void
}

/**
 * Coalesces all sync triggers into one active run and an optional single
 * follow-up. Leadership is injected so this state machine can be tested
 * without browser locks, timers, or a network transport.
 */
export interface SyncScheduler {
  trigger(reason: string): void
  whenIdle(): Promise<void>
  stop(): void
}

export function createSyncScheduler(
  options: SyncSchedulerOptions
): SyncScheduler {
  let running = false
  let queued = false
  let queuedReason = "queued"
  let activeRun: Promise<void> | null = null
  let stopped = false

  function trigger(reason: string): void {
    if (stopped || options.enabled?.() === false) return
    if (running) {
      queued = true
      queuedReason = reason
      return
    }

    running = true
    const run = runScheduler(reason)
    activeRun = run
    void run.finally(() => {
      if (activeRun === run) activeRun = null
    })
  }

  async function whenIdle(): Promise<void> {
    const run = activeRun
    if (run) await run
  }

  function stop(): void {
    stopped = true
    queued = false
  }

  async function runScheduler(initialReason: string): Promise<void> {
    let reason = initialReason
    try {
      do {
        queued = false
        if (options.enabled?.() === false) break
        const execute = () => options.execute(reason)
        if (options.acquireLeadership) {
          await options.acquireLeadership(execute)
        } else {
          await execute()
        }
        reason = queuedReason
      } while (queued && !stopped)
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
    }
  }

  return { trigger, whenIdle, stop }
}
