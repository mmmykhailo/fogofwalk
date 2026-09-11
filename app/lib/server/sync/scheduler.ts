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
export class SyncScheduler {
  private running = false
  private queued = false
  private queuedReason = "queued"
  private activeRun: Promise<void> | null = null
  private stopped = false

  constructor(private readonly options: SyncSchedulerOptions) {}

  trigger(reason: string): void {
    if (this.stopped || this.options.enabled?.() === false) return
    if (this.running) {
      this.queued = true
      this.queuedReason = reason
      return
    }

    this.running = true
    const run = this.run(reason)
    this.activeRun = run
    void run.finally(() => {
      if (this.activeRun === run) this.activeRun = null
    })
  }

  async whenIdle(): Promise<void> {
    const run = this.activeRun
    if (run) await run
  }

  stop(): void {
    this.stopped = true
    this.queued = false
  }

  private async run(initialReason: string): Promise<void> {
    let reason = initialReason
    try {
      do {
        this.queued = false
        if (this.options.enabled?.() === false) break
        const execute = () => this.options.execute(reason)
        if (this.options.acquireLeadership) {
          await this.options.acquireLeadership(execute)
        } else {
          await execute()
        }
        reason = this.queuedReason
      } while (this.queued && !this.stopped)
    } catch (error) {
      this.options.onError?.(error)
    } finally {
      this.running = false
    }
  }
}
