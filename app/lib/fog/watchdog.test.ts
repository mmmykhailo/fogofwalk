import { describe, expect, test } from "bun:test"
import { createFogWorkerWatchdog } from "./watchdog"

describe("fog worker watchdog", () => {
  test("waits for the deadline and reports a request once", () => {
    let clock = 100
    const timedOut: string[] = []
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 50,
      now: () => clock,
      onTimeout: (request) => timedOut.push(request.requestId),
    })

    watchdog.observe({ requestId: "request-1", generation: 4 })
    expect(watchdog.check(149)).toBe(false)
    expect(watchdog.check(150)).toBe(true)
    expect(watchdog.check(200)).toBe(false)
    expect(timedOut).toEqual(["request-1"])
  })

  test("replacing or clearing a request resets its deadline", () => {
    let clock = 0
    const timedOut: string[] = []
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 10,
      now: () => clock,
      onTimeout: (request) => timedOut.push(request.requestId),
    })

    watchdog.observe({ requestId: "old", generation: 1 })
    clock = 9
    watchdog.observe({ requestId: "new", generation: 2 })
    expect(watchdog.check(10)).toBe(false)
    expect(watchdog.activeRequest?.requestId).toBe("new")
    watchdog.observe(null)
    expect(watchdog.check(100)).toBe(false)
    expect(timedOut).toEqual([])
  })

  test("[F-041] refreshes the deadline when the active request makes progress", () => {
    let clock = 0
    const timedOut: string[] = []
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 10,
      now: () => clock,
      onTimeout: (request) => timedOut.push(request.requestId),
    })

    watchdog.observe({ requestId: "active", generation: 1 })
    clock = 9
    watchdog.observe({ requestId: "active", generation: 1 })
    expect(watchdog.check(10)).toBe(false)
    expect(watchdog.check(18)).toBe(false)
    expect(watchdog.check(19)).toBe(true)
    expect(timedOut).toEqual(["active"])
  })

  test("does not refresh the deadline during passive polling", () => {
    let clock = 0
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 10,
      now: () => clock,
      onTimeout: () => undefined,
    })

    watchdog.observe({ requestId: "active", generation: 1 })
    clock = 9
    watchdog.observe({ requestId: "active", generation: 1 }, false)
    expect(watchdog.check(10)).toBe(true)
  })

  test("uses a longer bounded deadline for active aggregation", () => {
    let clock = 0
    const timedOut: string[] = []
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 10,
      stageTimeoutMs: { aggregating: 30 },
      now: () => clock,
      onTimeout: (request) => timedOut.push(request.requestId),
    })

    watchdog.observe({
      requestId: "active",
      generation: 1,
      stage: "buffering",
    })
    clock = 9
    watchdog.observe({
      requestId: "active",
      generation: 1,
      stage: "aggregating",
    })
    expect(watchdog.check(38)).toBe(false)
    expect(watchdog.check(39)).toBe(true)
    expect(timedOut).toEqual(["active"])
  })
})
