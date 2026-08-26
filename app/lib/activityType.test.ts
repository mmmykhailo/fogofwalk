import { describe, expect, test } from "bun:test"
import { normalizeActivityType } from "./activityType"

describe("normalizeActivityType", () => {
  test("normalizes supported GPX and FIT values", () => {
    expect(normalizeActivityType("Walking")).toBe("walking")
    expect(normalizeActivityType("trail-running")).toBe("running")
    expect(normalizeActivityType("e_biking")).toBe("cycling")
    expect(normalizeActivityType("paddling")).toBe("kayaking")
    expect(normalizeActivityType("open water swimming")).toBe("swimming")
  })

  test("maps present unsupported values to other", () => {
    expect(normalizeActivityType("alpine_skiing")).toBe("other")
  })

  test("leaves missing metadata unset", () => {
    expect(normalizeActivityType(undefined)).toBeUndefined()
    expect(normalizeActivityType("  ")).toBeUndefined()
  })
})
