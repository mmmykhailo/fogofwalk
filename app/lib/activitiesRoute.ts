import {
  isActivitySortOption,
  type ActivitySortOption,
} from "~/lib/statsAggregator"
import {
  clampPage,
  getPageItems,
  getPageRange,
  getTotalPages,
  parsePage,
  type PageItem,
} from "~/lib/pagination"

export const ACTIVITIES_PAGE_SIZE = 48
export const DEFAULT_ACTIVITY_SORT_OPTION = "date" as const

export type ActivitiesQuery = {
  sortOption: ActivitySortOption
  page: number
  searchParams: URLSearchParams
}

export type ActivitiesPageItem = PageItem

/** Returns the number of pages needed to show an activity count. */
export function getActivitiesTotalPages(activityCount: number): number {
  return getTotalPages(activityCount, ACTIVITIES_PAGE_SIZE)
}

/** Parses a page query value, returning null when it is not a positive integer. */
export function parseActivitiesPage(value: string | null): number | null {
  return parsePage(value)
}

/** Clamps a parsed page to the valid page range, which always includes page 1. */
export function clampActivitiesPage(
  page: number | null,
  totalPages: number
): number {
  return clampPage(page, totalPages)
}

/**
 * Resolves and canonicalizes the activities view query.
 *
 * The first value wins when a parameter is repeated, and unrelated parameters
 * are copied through unchanged. Page 1 is represented by an omitted
 * parameter; an explicit valid sort remains explicit for stable shared URLs.
 */
export function getCanonicalActivitiesQuery(
  searchParams: URLSearchParams,
  totalPages = Number.MAX_SAFE_INTEGER
): ActivitiesQuery {
  const rawSort = searchParams.get("sort")
  const sortOption = isActivitySortOption(rawSort)
    ? rawSort
    : DEFAULT_ACTIVITY_SORT_OPTION
  const page = clampActivitiesPage(
    parseActivitiesPage(searchParams.get("page")),
    totalPages
  )
  const canonicalSearchParams = new URLSearchParams(searchParams)

  if (rawSort == null || !isActivitySortOption(rawSort)) {
    canonicalSearchParams.delete("sort")
  } else {
    canonicalSearchParams.set("sort", sortOption)
  }

  if (page === 1) canonicalSearchParams.delete("page")
  else canonicalSearchParams.set("page", String(page))

  return { sortOption, page, searchParams: canonicalSearchParams }
}

/** Returns the half-open activity index range for a page. */
export function getActivitiesPageRange(
  activityCount: number,
  page: number
): { start: number; end: number } {
  return getPageRange(activityCount, page, ACTIVITIES_PAGE_SIZE)
}

/** Returns the compact page control sequence for the pagination UI. */
export function getActivitiesPageItems(
  currentPage: number,
  totalPages: number
): ActivitiesPageItem[] {
  return getPageItems(currentPage, totalPages)
}

function areSearchParamsEqualIgnoring(
  currentUrl: URL,
  nextUrl: URL,
  ignoredParams: ReadonlySet<string>
): boolean {
  const entries = (url: URL) =>
    [...url.searchParams.entries()]
      .filter(([key]) => !ignoredParams.has(key))
      .sort(([firstKey, firstValue], [secondKey, secondValue]) =>
        firstKey === secondKey
          ? firstValue.localeCompare(secondValue)
          : firstKey.localeCompare(secondKey)
      )

  return (
    JSON.stringify(entries(currentUrl)) === JSON.stringify(entries(nextUrl))
  )
}

function areActivitiesViewParamsEqual(currentUrl: URL, nextUrl: URL): boolean {
  const entries = (url: URL) =>
    [...url.searchParams.entries()].filter(
      ([key]) => key === "sort" || key === "page"
    )

  return (
    JSON.stringify(entries(currentUrl)) === JSON.stringify(entries(nextUrl))
  )
}

/** True when an activities navigation changes only its supported view params. */
export function isActivitiesViewOnlyNavigation(
  currentUrl: URL,
  nextUrl: URL
): boolean {
  if (
    currentUrl.pathname !== "/activities" ||
    nextUrl.pathname !== "/activities"
  ) {
    return false
  }

  if (
    !areSearchParamsEqualIgnoring(
      currentUrl,
      nextUrl,
      new Set(["sort", "page"])
    )
  )
    return false

  if (areActivitiesViewParamsEqual(currentUrl, nextUrl)) return false

  const currentQuery = getCanonicalActivitiesQuery(currentUrl.searchParams)
  const nextQuery = getCanonicalActivitiesQuery(nextUrl.searchParams)
  const effectiveStateChanged =
    currentQuery.sortOption !== nextQuery.sortOption ||
    currentQuery.page !== nextQuery.page
  const canonicalStateChanged =
    currentQuery.searchParams.get("sort") !==
      nextQuery.searchParams.get("sort") ||
    currentQuery.searchParams.get("page") !== nextQuery.searchParams.get("page")
  const currentNeedsNormalization =
    currentQuery.searchParams.toString() !== currentUrl.searchParams.toString()
  const nextNeedsNormalization =
    nextQuery.searchParams.toString() !== nextUrl.searchParams.toString()

  // A canonical state change is a view-only navigation. When the effective
  // state is unchanged, the navigation is still view-only if either URL is an
  // alias that the grid will normalize with replace history; this prevents an
  // extra IndexedDB read during that replace.
  return (
    effectiveStateChanged ||
    canonicalStateChanged ||
    currentNeedsNormalization ||
    nextNeedsNormalization
  )
}
