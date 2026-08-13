import { beforeEach, describe, expect, test } from "bun:test"

import {
  createExportConcurrencyGate,
  exportOverloadRetryAfterMs,
} from "../src/account/exportConcurrency"

describe("export concurrency gate", () => {
  test("bounds simultaneous exports and releases slots safely", () => {
    const gate = createExportConcurrencyGate(2)
    const first = gate.acquire()
    const second = gate.acquire()

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(gate.acquire()).toBeNull()
    expect(exportOverloadRetryAfterMs).toBeGreaterThan(0)

    first?.()
    first?.()
    const third = gate.acquire()
    expect(third).not.toBeNull()

    second?.()
    third?.()
  })
})
