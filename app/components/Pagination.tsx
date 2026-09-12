import { Button } from "~/components/ui/button"
import { getPageItems, getPageRange } from "~/lib/pagination"

interface PaginationProps {
  itemCount: number
  pageSize: number
  itemLabel: string
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({
  itemCount,
  pageSize,
  itemLabel,
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  const { start, end } = getPageRange(itemCount, currentPage, pageSize)
  const pageItems = getPageItems(currentPage, totalPages)

  return (
    <div className="mt-4 flex flex-col flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
      <span aria-live="polite">
        Showing {start + 1}–{end} of {itemCount} {itemLabel}
      </span>
      {totalPages > 1 && (
        <nav
          aria-label={`${itemLabel[0]!.toUpperCase()}${itemLabel.slice(1)} pages`}
          className="flex flex-wrap items-center justify-center gap-1"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            Previous
          </Button>
          {pageItems.map((item, index) =>
            item === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === currentPage ? "secondary" : "outline"}
                size="sm"
                aria-label={`Page ${item}`}
                aria-current={item === currentPage ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            )
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  )
}
