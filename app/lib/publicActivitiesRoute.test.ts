import { describe, expect, test } from "bun:test"
import { getCanonicalPublicActivitiesPage } from "./publicActivitiesRoute"

describe("public activities page query", () => {
  test("normalizes invalid and first-page aliases while preserving unrelated parameters", () => {
    expect([
      ...getCanonicalPublicActivitiesPage(
        new URLSearchParams("page=bad&tab=map"),
        49
      ).searchParams.entries(),
    ]).toEqual([["tab", "map"]])
    expect([
      ...getCanonicalPublicActivitiesPage(
        new URLSearchParams("page=002&tab=map"),
        49
      ).searchParams.entries(),
    ]).toEqual([
      ["page", "2"],
      ["tab", "map"],
    ])
  })

  test("clamps pages made invalid by a visibility change", () => {
    const result = getCanonicalPublicActivitiesPage(
      new URLSearchParams("page=2"),
      48
    )
    expect(result.page).toBe(1)
    expect(result.searchParams.toString()).toBe("")
  })

  test("clamps an out-of-range page to the last page", () => {
    const result = getCanonicalPublicActivitiesPage(
      new URLSearchParams("page=999"),
      49
    )
    expect(result.page).toBe(2)
    expect(result.searchParams.toString()).toBe("page=2")
  })
})
