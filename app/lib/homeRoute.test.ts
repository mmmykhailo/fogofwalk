import { describe, expect, test } from "bun:test"
import { shouldRevalidateHome, withoutSearchParams } from "~/lib/homeRoute"

const url = (value: string) => new URL(`https://fogofwalk.test${value}`)

function revalidate(
  current: string,
  next: string,
  overrides: Partial<Parameters<typeof shouldRevalidateHome>[0]> = {}
) {
  return shouldRevalidateHome({
    currentUrl: url(current),
    nextUrl: url(next),
    defaultShouldRevalidate: true,
    ...overrides,
  })
}

describe("home route revalidation", () => {
  test("preserves explicit same-URL revalidation", () => {
    expect(revalidate("/map", "/map")).toBe(true)
    expect(revalidate("/map", "/map", { defaultShouldRevalidate: false })).toBe(
      false
    )
  })

  test("does not restore for map surface query changes", () => {
    expect(revalidate("/map", "/map?activity=one")).toBe(false)
    expect(revalidate("/map?activity=one", "/map")).toBe(false)
    expect(revalidate("/map?savedPoint=one", "/map")).toBe(false)
    expect(revalidate("/map?from-share=one", "/map")).toBe(false)
    expect(
      revalidate("/map?activity=one&keep=1", "/map?savedPoint=two&keep=1")
    ).toBe(false)
    expect(revalidate("/map?keep=1", "/map?keep=2")).toBe(true)
  })

  test("enters the map once and avoids restoring it on exit", () => {
    expect(revalidate("/help", "/map")).toBe(true)
    expect(revalidate("/activities", "/map?activity=one")).toBe(true)
    expect(revalidate("/map", "/help")).toBe(false)
  })

  test("keeps activities view-only and child-to-child navigation local", () => {
    expect(revalidate("/activities", "/activities?page=2")).toBe(false)
    expect(revalidate("/help", "/activities")).toBe(false)
    expect(revalidate("/stats", "/saved-points")).toBe(false)
    expect(revalidate("/activities", "/activities?filter=walking")).toBe(false)
  })

  test("uses action reconciliation only when explicitly declared", () => {
    expect(
      revalidate("/map", "/map", {
        formMethod: "POST",
        actionResult: { homeDataReconciled: true },
      })
    ).toBe(false)
    expect(
      revalidate("/map", "/map", {
        formMethod: "POST",
        actionResult: { ok: true },
      })
    ).toBe(true)
    expect(
      revalidate("/map", "/map", {
        formMethod: "POST",
        actionResult: { homeDataReconciled: true },
        defaultShouldRevalidate: false,
      })
    ).toBe(false)
  })
})

describe("withoutSearchParams", () => {
  test("returns null for an already absent parameter", () => {
    const params = new URLSearchParams("keep=1")
    expect(withoutSearchParams(params, ["activity", "savedPoint"])).toBeNull()
    expect(params.toString()).toBe("keep=1")
  })

  test("copies and removes only requested parameters", () => {
    const params = new URLSearchParams("activity=one&keep=1&savedPoint=two")
    const next = withoutSearchParams(params, ["activity", "savedPoint"])
    expect(next?.toString()).toBe("keep=1")
    expect(params.toString()).toBe("activity=one&keep=1&savedPoint=two")
  })
})
