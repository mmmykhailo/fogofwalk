import { describe, expect, test } from "bun:test"

import { checkExportRateLimit } from "../src/account/exportRateLimit"

describe("export rate limit", () => {
  test("allows one request, then reports the retry delay", () => {
    const now = 1_000_000

    expect(checkExportRateLimit("rate-test-user", now)).toEqual({ ok: true })

    const limited = checkExportRateLimit("rate-test-user", now + 1)
    expect(limited.ok).toBe(false)
    if (!limited.ok) expect(limited.retryAfterMs).toBe(899_999)
  })

  test("keeps users independent and slides the window", () => {
    const now = 2_000_000

    expect(checkExportRateLimit("user-a", now)).toEqual({ ok: true })
    expect(checkExportRateLimit("user-b", now)).toEqual({ ok: true })
    expect(checkExportRateLimit("user-a", now + 900_001)).toEqual({
      ok: true,
    })
  })
})
