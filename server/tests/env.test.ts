import { describe, expect, test } from "bun:test"

import { parseEnv } from "../src/env"

function baseEnv(): Record<string, string> {
  return {
    PUBLIC_URL: "http://localhost:8787",
    ALLOWED_ORIGINS: "http://localhost:5173",
    ADMIN_LOGINS: "github:admin-user",
    SESSION_SECRET: "test-secret-that-is-long-enough-0123456789",
  }
}

describe("DEV_FAKE_AUTH", () => {
  test("is disabled unless explicitly enabled", () => {
    expect(parseEnv(baseEnv()).DEV_FAKE_AUTH).toBe(false)
  })

  test("allows local-only fake authentication", () => {
    expect(
      parseEnv({ ...baseEnv(), DEV_FAKE_AUTH: "true" }).DEV_FAKE_AUTH
    ).toBe(true)
  })

  test("refuses a fake auth mode exposed beyond loopback", () => {
    expect(() =>
      parseEnv({
        ...baseEnv(),
        DEV_FAKE_AUTH: "true",
        ALLOWED_ORIGINS: "https://app.example",
      })
    ).toThrow("DEV_FAKE_AUTH=true is only allowed")
  })
})
