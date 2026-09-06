import { Pagination } from "~/components/Pagination"
import { ACTIVITIES_PAGE_SIZE } from "~/lib/activitiesRoute"

interface ActivitiesPaginationProps {
  activityCount: number
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function ActivitiesPagination({
  activityCount,
  currentPage,
  totalPages,
  onPageChange,
}: ActivitiesPaginationProps) {
  return (
    <Pagination
      itemCount={activityCount}
      pageSize={ACTIVITIES_PAGE_SIZE}
      itemLabel="activities"
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={onPageChange}
    />
  )
}
