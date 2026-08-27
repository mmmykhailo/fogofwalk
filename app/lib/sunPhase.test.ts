import { describe, expect, test } from "bun:test"

import { deriveStartSunPhase } from "./sunPhase"

describe("deriveStartSunPhase", () => {
  const berlin: [number, number] = [13.405, 52.52]

  test("classifies before sunrise, daylight, and after sunset", () => {
    expect(deriveStartSunPhase([berlin], Date.UTC(2024, 5, 21, 1, 0))).toBe(
      "before_sunrise"
    )
    expect(deriveStartSunPhase([berlin], Date.UTC(2024, 5, 21, 12, 0))).toBe(
      "daylight"
    )
    expect(deriveStartSunPhase([berlin], Date.UTC(2024, 5, 21, 21, 0))).toBe(
      "after_sunset"
    )
  })

  test("uses the first valid coordinate and leaves incomplete or polar data unknown", () => {
    expect(
      deriveStartSunPhase(
        [[Infinity, 52.52], berlin],
        Date.UTC(2024, 5, 21, 12)
      )
    ).toBe("daylight")
    expect(deriveStartSunPhase([berlin], null)).toBe("unknown")
    expect(deriveStartSunPhase([[0, 89]], Date.UTC(2024, 5, 21, 12))).toBe(
      "unknown"
    )
  })
})
