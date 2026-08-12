import { beforeEach, describe, expect, test } from "bun:test"

import {
  acquireExportSlot,
  exportOverloadRetryAfterMs,
  resetExportConcurrency,
} from "../src/account/exportConcurrency"

beforeEach(() => {
  resetExportConcurrency()
})

describe("export concurrency gate", () => {
  test("bounds simultaneous exports and releases slots safely", () => {
    const first = acquireExportSlot()
    const second = acquireExportSlot()

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(acquireExportSlot()).toBeNull()
    expect(exportOverloadRetryAfterMs).toBeGreaterThan(0)

    first?.()
    first?.()
    const third = acquireExportSlot()
    expect(third).not.toBeNull()

    second?.()
    third?.()
  })
})
