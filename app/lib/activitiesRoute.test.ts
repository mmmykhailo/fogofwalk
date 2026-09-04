import { describe, expect, test } from "bun:test"
import {
  ACTIVITIES_PAGE_SIZE,
  clampActivitiesPage,
  getCanonicalActivitiesQuery,
  getActivitiesPageItems,
  getActivitiesPageRange,
  getActivitiesTotalPages,
  isActivitiesViewOnlyNavigation,
  parseActivitiesPage,
} from "./activitiesRoute"

describe("activities pagination helpers", () => {
  test("calculates page counts and half-open ranges", () => {
    expect(ACTIVITIES_PAGE_SIZE).toBe(48)
    expect(getActivitiesTotalPages(0)).toBe(1)
    expect(getActivitiesTotalPages(1)).toBe(1)
    expect(getActivitiesTotalPages(48)).toBe(1)
    expect(getActivitiesTotalPages(49)).toBe(2)
    expect(getActivitiesTotalPages(96)).toBe(2)
    expect(getActivitiesTotalPages(97)).toBe(3)

    expect(getActivitiesPageRange(0, 1)).toEqual({ start: 0, end: 0 })
    expect(getActivitiesPageRange(49, 1)).toEqual({ start: 0, end: 48 })
    expect(getActivitiesPageRange(49, 2)).toEqual({ start: 48, end: 49 })
    expect(getActivitiesPageRange(97, 3)).toEqual({ start: 96, end: 97 })
    expect(getActivitiesPageRange(97, 99)).toEqual({ start: 96, end: 97 })
  })

  test("parses and clamps page values", () => {
    expect(parseActivitiesPage(null)).toBe(null)
    expect(parseActivitiesPage("1")).toBe(1)
    expect(parseActivitiesPage("002")).toBe(2)
    expect(parseActivitiesPage("1.5")).toBe(null)
    expect(parseActivitiesPage("nope")).toBe(null)
    expect(parseActivitiesPage("-1")).toBe(null)
    expect(parseActivitiesPage("0")).toBe(null)
    expect(parseActivitiesPage("999999999999999999999")).toBe(
      Number.MAX_SAFE_INTEGER
    )

    expect(clampActivitiesPage(null, 3)).toBe(1)
    expect(clampActivitiesPage(0, 3)).toBe(1)
    expect(clampActivitiesPage(2, 3)).toBe(2)
    expect(clampActivitiesPage(9, 3)).toBe(3)
  })

  test("keeps a compact page window near each boundary", () => {
    expect(getActivitiesPageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(getActivitiesPageItems(1, 20)).toEqual([1, 2, 3, "ellipsis", 20])
    expect(getActivitiesPageItems(10, 20)).toEqual([
      1,
      "ellipsis",
      9,
      10,
      11,
      "ellipsis",
      20,
    ])
    expect(getActivitiesPageItems(20, 20)).toEqual([1, "ellipsis", 18, 19, 20])
  })
})

describe("canonical activities query", () => {
  const query = (value: string, totalPages = 3) =>
    getCanonicalActivitiesQuery(new URLSearchParams(value), totalPages)

  test("uses the default sort when sort is missing, empty, invalid, or mixed-case", () => {
    for (const value of ["", "sort=", "sort=unsupported", "sort=Distance"]) {
      const result = query(value)
      expect(result.sortOption).toBe("date")
      expect(result.searchParams.has("sort")).toBe(false)
    }
  })

  test("keeps valid sort values and collapses repeated values", () => {
    const result = query("sort=distance&sort=speed")

    expect(result.sortOption).toBe("distance")
    expect(result.searchParams.getAll("sort")).toEqual(["distance"])
  })

  test("keeps an explicit valid default sort for stable URLs", () => {
    const result = query("sort=date")

    expect(result.sortOption).toBe("date")
    expect(result.searchParams.get("sort")).toBe("date")
  })

  test("normalizes page together with sort while preserving unrelated params", () => {
    const result = query("filter=walking&sort=bad&page=002&filter=recent")

    expect(result.page).toBe(2)
    expect([...result.searchParams.entries()]).toEqual([
      ["filter", "walking"],
      ["page", "2"],
      ["filter", "recent"],
    ])
  })

  test("removes invalid view parameters in one canonical result", () => {
    const result = query("sort=DATE&page=bad&filter=walking")

    expect(result.searchParams.toString()).toBe("filter=walking")
  })
})

describe("activities view-only navigation", () => {
  const url = (path: string) => new URL(`http://localhost${path}`)

  test("accepts page, sort, and combined view changes", () => {
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities"),
        url("/activities?page=2")
      )
    ).toBe(true)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?page=2"),
        url("/activities?page=3&sort=distance")
      )
    ).toBe(true)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?sort=date"),
        url("/activities?sort=distance")
      )
    ).toBe(true)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?page=bad"),
        url("/activities?page=2")
      )
    ).toBe(true)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?sort=unsupported&page=bad"),
        url("/activities")
      )
    ).toBe(true)
  })

  test("rejects actions, path changes, and unrelated parameters", () => {
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?page=2"),
        url("/activities?page=3&filter=walking")
      )
    ).toBe(false)
    expect(
      isActivitiesViewOnlyNavigation(url("/map"), url("/activities?page=2"))
    ).toBe(false)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?page=2"),
        url("/activities?page=2")
      )
    ).toBe(false)
  })

  test("treats back and forward between canonical view states as view-only", () => {
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities?sort=distance&page=2"),
        url("/activities")
      )
    ).toBe(true)
    expect(
      isActivitiesViewOnlyNavigation(
        url("/activities"),
        url("/activities?sort=distance&page=2")
      )
    ).toBe(true)
  })
})
