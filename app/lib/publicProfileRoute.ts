import { clampPage, getTotalPages, parsePage } from "~/lib/pagination"
import { PUBLIC_ACTIVITY_PAGE_SIZE } from "~shared/constants"

export interface PublicProfilePageQuery {
  page: number
  searchParams: URLSearchParams
}

/**
 * Canonicalizes the public activity page while preserving unrelated search
 * parameters. Page one is represented by the absence of a `page` parameter.
 */
export function getCanonicalPublicProfilePage(
  searchParams: URLSearchParams,
  activityCount = Number.MAX_SAFE_INTEGER
): PublicProfilePageQuery {
  const page = clampPage(
    parsePage(searchParams.get("page")),
    getTotalPages(activityCount, PUBLIC_ACTIVITY_PAGE_SIZE)
  )
  const canonicalSearchParams = new URLSearchParams(searchParams)

  if (page === 1) canonicalSearchParams.delete("page")
  else canonicalSearchParams.set("page", String(page))

  return { page, searchParams: canonicalSearchParams }
}
