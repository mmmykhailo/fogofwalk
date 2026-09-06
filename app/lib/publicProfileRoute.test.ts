import { describe, expect, test } from "bun:test"
import { getCanonicalPublicProfilePage } from "./publicProfileRoute"

describe("public profile page query", () => {
  test("normalizes invalid and first-page aliases while preserving unrelated parameters", () => {
    expect([
      ...getCanonicalPublicProfilePage(
        new URLSearchParams("page=bad&tab=map"),
        49
      ).searchParams.entries(),
    ]).toEqual([["tab", "map"]])
    expect([
      ...getCanonicalPublicProfilePage(
        new URLSearchParams("page=002&tab=map"),
        49
      ).searchParams.entries(),
    ]).toEqual([
      ["page", "2"],
      ["tab", "map"],
    ])
  })

  test("clamps pages made invalid by a visibility change", () => {
    const result = getCanonicalPublicProfilePage(
      new URLSearchParams("page=2"),
      48
    )
    expect(result.page).toBe(1)
    expect(result.searchParams.toString()).toBe("")
  })
})
