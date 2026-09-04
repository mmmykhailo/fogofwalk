import { isActivitySortOption } from "~/lib/statsAggregator"

/** True when only a supported activities sort value changed. */
export function isActivitiesSortOnlyNavigation(
  currentUrl: URL,
  nextUrl: URL
): boolean {
  if (
    currentUrl.pathname !== "/activities" ||
    nextUrl.pathname !== "/activities"
  ) {
    return false
  }

  const currentOtherParams = new URLSearchParams(currentUrl.search)
  const nextOtherParams = new URLSearchParams(nextUrl.search)
  currentOtherParams.delete("sort")
  nextOtherParams.delete("sort")
  if (currentOtherParams.toString() !== nextOtherParams.toString()) {
    return false
  }

  const nextSort = nextUrl.searchParams.get("sort")
  return (
    isActivitySortOption(nextSort) &&
    currentUrl.searchParams.get("sort") !== nextSort
  )
}
