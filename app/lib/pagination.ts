export type PageItem = number | "ellipsis"

function normalizeItemCount(itemCount: number): number {
  return Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0
}

/** Returns the number of pages needed to show an item count. */
export function getTotalPages(itemCount: number, pageSize: number): number {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1
  return Math.max(1, Math.ceil(normalizeItemCount(itemCount) / size))
}

/** Parses a positive integer page query value, or null when it is invalid. */
export function parsePage(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null

  const page = Number(value)
  if (page <= 0) return null
  return Number.isSafeInteger(page) ? page : Number.MAX_SAFE_INTEGER
}

/** Clamps a parsed page to a page range that always includes page 1. */
export function clampPage(page: number | null, totalPages: number): number {
  const lastPage = Number.isFinite(totalPages)
    ? Math.max(1, Math.floor(totalPages))
    : 1
  if (page == null) return 1
  if (page === Infinity) return lastPage
  if (page === -Infinity || Number.isNaN(page)) return 1
  return Math.min(Math.max(1, Math.floor(page)), lastPage)
}

/** Returns the half-open item index range for a page. */
export function getPageRange(
  itemCount: number,
  page: number,
  pageSize: number
): { start: number; end: number } {
  const count = normalizeItemCount(itemCount)
  const currentPage = clampPage(page, getTotalPages(count, pageSize))
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1
  const start = (currentPage - 1) * size
  return { start, end: Math.min(start + size, count) }
}

/** Returns the compact page control sequence for a pagination UI. */
export function getPageItems(
  currentPage: number,
  totalPages: number
): PageItem[] {
  const lastPage = Number.isFinite(totalPages)
    ? Math.max(1, Math.floor(totalPages))
    : 1
  const page = clampPage(currentPage, lastPage)
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
  const items: PageItem[] = []

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
