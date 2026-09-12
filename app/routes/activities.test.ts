import { describe, expect, test } from "bun:test"
import { shouldRevalidate } from "~/routes/activities"

describe("activities route revalidation", () => {
  const revalidate = (current: string, next: string, extra = {}) =>
    shouldRevalidate({
      currentUrl: new URL(`http://localhost${current}`),
      currentParams: {},
      nextUrl: new URL(`http://localhost${next}`),
      nextParams: {},
      defaultShouldRevalidate: true,
      ...extra,
    })

  test("skips loader work for supported view-only navigation", () => {
    expect(revalidate("/activities", "/activities?sort=distance")).toBe(false)
    expect(
      revalidate("/activities?sort=distance", "/activities?sort=speed")
    ).toBe(false)
    expect(
      revalidate("/activities?sort=speed", "/activities?sort=speed&page=2")
    ).toBe(false)
    expect(
      revalidate(
        "/activities?sort=speed&page=2",
        "/activities?sort=distance&page=3"
      )
    ).toBe(false)
  })

  test("skips loader work while replacing malformed view queries", () => {
    expect(revalidate("/activities?sort=bogus&page=wat", "/activities")).toBe(
      false
    )
    expect(revalidate("/activities", "/activities?sort=Distance&page=01")).toBe(
      false
    )
    expect(
      revalidate(
        "/activities?sort=distance&sort=speed&page=002",
        "/activities?sort=distance&page=2"
      )
    ).toBe(false)
  })

  test("keeps unrelated query changes on the loader path", () => {
    expect(
      revalidate(
        "/activities?sort=bogus&page=wat&filter=walking",
        "/activities?filter=cycling"
      )
    ).toBe(true)
  })

  test("keeps default revalidation for actions and unrelated changes", () => {
    expect(
      revalidate("/activities?sort=date", "/activities?sort=distance", {
        formMethod: "POST",
      })
    ).toBe(true)
    expect(revalidate("/activities", "/activities?filter=walking")).toBe(true)
    expect(revalidate("/map", "/activities?sort=distance")).toBe(true)
    expect(
      shouldRevalidate({
        currentUrl: new URL("http://localhost/activities"),
        currentParams: {},
        nextUrl: new URL("http://localhost/activities?sort=distance"),
        nextParams: {},
        defaultShouldRevalidate: false,
      })
    ).toBe(false)
  })
})
