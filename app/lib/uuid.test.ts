import { expect, test } from "bun:test"
import { createUuid } from "~/lib/uuid"

test("creates UUID v4 values", () => {
  expect(createUuid()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
})

test("falls back when randomUUID is unavailable", () => {
  const cryptoApi = globalThis.crypto
  const randomUuid = cryptoApi.randomUUID
  Object.defineProperty(cryptoApi, "randomUUID", {
    configurable: true,
    value: undefined,
  })

  try {
    expect(createUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  } finally {
    Object.defineProperty(cryptoApi, "randomUUID", {
      configurable: true,
      value: randomUuid,
    })
  }
})
