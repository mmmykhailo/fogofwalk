import { isActivitySortOption } from "~/lib/statsAggregator"

export const ACTIVITIES_PAGE_SIZE = 48

export type ActivitiesPageItem = number | "ellipsis"

function normalizeActivityCount(activityCount: number): number {
  return Number.isFinite(activityCount)
    ? Math.max(0, Math.floor(activityCount))
    : 0
}

/** Returns the number of pages needed to show an activity count. */
export function getActivitiesTotalPages(activityCount: number): number {
  return Math.max(
    1,
    Math.ceil(normalizeActivityCount(activityCount) / ACTIVITIES_PAGE_SIZE)
  )
}

/** Parses a page query value, returning null when it is not a positive integer. */
export function parseActivitiesPage(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null

  const page = Number(value)
  if (page <= 0) return null
  return Number.isSafeInteger(page) ? page : Number.MAX_SAFE_INTEGER
}

/** Clamps a parsed page to the valid page range, which always includes page 1. */
export function clampActivitiesPage(
  page: number | null,
  totalPages: number
): number {
  const lastPage = Number.isFinite(totalPages)
    ? Math.max(1, Math.floor(totalPages))
    : 1
  if (page == null) return 1
  if (page === Infinity) return lastPage
  if (page === -Infinity || Number.isNaN(page)) return 1
  return Math.min(Math.max(1, Math.floor(page)), lastPage)
}

/** Returns the half-open activity index range for a page. */
export function getActivitiesPageRange(
  activityCount: number,
  page: number
): { start: number; end: number } {
  const count = normalizeActivityCount(activityCount)
  const currentPage = clampActivitiesPage(page, getActivitiesTotalPages(count))
  const start = (currentPage - 1) * ACTIVITIES_PAGE_SIZE
  return {
    start,
    end: Math.min(start + ACTIVITIES_PAGE_SIZE, count),
  }
}

/** Returns the compact page control sequence for the pagination UI. */
export function getActivitiesPageItems(
  currentPage: number,
  totalPages: number
): ActivitiesPageItem[] {
  const lastPage = Number.isFinite(totalPages)
    ? Math.max(1, Math.floor(totalPages))
    : 1
  const page = clampActivitiesPage(currentPage, lastPage)
  if (lastPage <= 7) {
    return Array.from({ length: lastPage }, (_, index) => index + 1)
  }

  const pages = new Set([1, lastPage, page - 1, page, page + 1])
  if (page <= 3) {
    pages.add(2)
    pages.add(3)
  }
  if (page >= lastPage - 2) {
    pages.add(lastPage - 2)
    pages.add(lastPage - 1)
  }
  const sortedPages = [...pages]
    .filter((item) => item >= 1 && item <= lastPage)
    .sort((a, b) => a - b)
  const items: ActivitiesPageItem[] = []

  for (const [index, pageNumber] of sortedPages.entries()) {
    if (index > 0) {
      const previousPage = sortedPages[index - 1]!
      if (pageNumber - previousPage > 2) items.push("ellipsis")
      else if (pageNumber - previousPage === 2) items.push(previousPage + 1)
    }
    items.push(pageNumber)
  }

  return items
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

  const nextSort = nextUrl.searchParams.get("sort")
  const sortChanged = currentUrl.searchParams.get("sort") !== nextSort
  const pageChanged =
    currentUrl.searchParams.get("page") !== nextUrl.searchParams.get("page")

  return (
    (sortChanged || pageChanged) &&
    (nextSort == null || isActivitySortOption(nextSort))
  )
}

/** @deprecated Use isActivitiesViewOnlyNavigation. */
export const isActivitiesSortOnlyNavigation = isActivitiesViewOnlyNavigation
