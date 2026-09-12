import { isActivitiesViewOnlyNavigation } from "~/lib/activitiesRoute"

export interface HomeActionResultLike {
  homeDataReconciled?: boolean
}

export interface HomeRevalidationArgs {
  currentUrl: URL
  nextUrl: URL
  formMethod?: string | null
  actionResult?: unknown
  defaultShouldRevalidate: boolean
}

/** Return a copied query with only the named parameters removed. */
export function withoutSearchParams(
  current: URLSearchParams,
  names: readonly string[]
): URLSearchParams | null {
  if (!names.some((name) => current.has(name))) return null
  const next = new URLSearchParams(current)
  for (const name of names) next.delete(name)
  return next
}

function isGetOrNoSubmission(formMethod: string | null | undefined): boolean {
  return formMethod == null || formMethod.toUpperCase() === "GET"
}

function isReconciledActionResult(
  actionResult: unknown
): actionResult is HomeActionResultLike {
  return (
    typeof actionResult === "object" &&
    actionResult !== null &&
    (actionResult as HomeActionResultLike).homeDataReconciled === true
  )
}

function sameSearchParamsExcept(
  currentUrl: URL,
  nextUrl: URL,
  ignoredNames: readonly string[]
): boolean {
  const ignored = new Set(ignoredNames)
  const entries = (url: URL) =>
    [...url.searchParams.entries()].filter(([name]) => !ignored.has(name))
  return (
    JSON.stringify(entries(currentUrl)) === JSON.stringify(entries(nextUrl))
  )
}

/** Pure revalidation policy for the pathless home/layout loader. */
export function shouldRevalidateHome({
  currentUrl,
  nextUrl,
  formMethod,
  actionResult,
  defaultShouldRevalidate,
}: HomeRevalidationArgs): boolean {
  if (!isGetOrNoSubmission(formMethod)) {
    return isReconciledActionResult(actionResult)
      ? false
      : defaultShouldRevalidate
  }

  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate

  const currentIsMap = currentUrl.pathname === "/map"
  const nextIsMap = nextUrl.pathname === "/map"
  if (!currentIsMap && nextIsMap) return true
  if (currentIsMap && !nextIsMap) return false

  if (
    currentIsMap &&
    nextIsMap &&
    sameSearchParamsExcept(currentUrl, nextUrl, [
      "activity",
      "savedPoint",
      "from-share",
    ])
  ) {
    return false
  }

  if (isActivitiesViewOnlyNavigation(currentUrl, nextUrl)) return false

  if (!currentIsMap && !nextIsMap) return false

  return defaultShouldRevalidate
}
