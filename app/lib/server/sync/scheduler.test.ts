import { describe, expect, test } from "bun:test"
import { SyncScheduler } from "./scheduler"

describe("SyncScheduler", () => {
  test("coalesces triggers during a run into one follow-up", async () => {
    const starts: string[] = []
    let release: (() => void) | null = null
    const scheduler = new SyncScheduler({
      execute: async (reason) => {
        starts.push(reason)
        if (starts.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
      },
    })

    scheduler.trigger("focus")
    scheduler.trigger("online")
    scheduler.trigger("poll")
    release!()
    await scheduler.whenIdle()

    expect(starts).toEqual(["focus", "poll"])
  })

  test("runs only while enabled and reports execution failures", async () => {
    let enabled = false
    const errors: unknown[] = []
    let runs = 0
    const scheduler = new SyncScheduler({
      enabled: () => enabled,
      execute: async () => {
        runs++
        throw new Error("network")
      },
      onError: (error) => errors.push(error),
    })

    scheduler.trigger("disabled")
    enabled = true
    scheduler.trigger("enabled")
    await scheduler.whenIdle()

    expect(runs).toBe(1)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe("network")
  })

  test("does not start a second run when leadership is unavailable", async () => {
    let executions = 0
    let leadershipAttempts = 0
    const scheduler = new SyncScheduler({
      execute: async () => {
        executions++
      },
      acquireLeadership: async () => {
        leadershipAttempts++
        return false
      },
    })

    scheduler.trigger("focus")
    await scheduler.whenIdle()
    scheduler.trigger("poll")
    await scheduler.whenIdle()

    expect(leadershipAttempts).toBe(2)
    expect(executions).toBe(0)
  })
})
