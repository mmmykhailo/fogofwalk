import { describe, expect, test } from "bun:test"
import {
  clampPage,
  getPageItems,
  getPageRange,
  getTotalPages,
  parsePage,
} from "./pagination"

describe("pagination helpers", () => {
  test("parses, clamps, and ranges pages independently of an item type", () => {
    expect(parsePage("002")).toBe(2)
    expect(parsePage("0")).toBeNull()
    expect(clampPage(9, 3)).toBe(3)
    expect(getTotalPages(49, 48)).toBe(2)
    expect(getPageRange(49, 2, 48)).toEqual({ start: 48, end: 49 })
  })

  test("keeps page controls compact for long sequences", () => {
    expect(getPageItems(10, 20)).toEqual([
      1,
      "ellipsis",
      9,
      10,
      11,
      "ellipsis",
      20,
    ])
  })
})
