import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useFetcher, useSearchParams } from "react-router"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
import { ActivitiesPagination } from "~/components/activities/ActivitiesPagination"
import { ActivitiesGridWithSortingHeader } from "~/components/activities/ActivitiesGridWithSortingHeader"
import { ConfirmBulkActivityUpdateDialog } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import type { BulkActivityUpdateProposal } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import {
  isActivitySortOption,
  sortActivitiesBy,
  type ActivitySortOption,
} from "~/lib/statsAggregator"
import { commonActivityType, commonPublicity } from "~/lib/activitySettings"
import { useAuth } from "~/lib/server/authStore"
import type { ActivitySummary } from "~/types/activitySummary"
import type { clientAction } from "~/routes/activities"
import { markPerformance, measurePerformance } from "~/lib/performance"
import {
  clampActivitiesPage,
  getActivitiesPageRange,
  getActivitiesTotalPages,
  parseActivitiesPage,
} from "~/lib/activitiesRoute"

const DEFAULT_SORT_OPTION: ActivitySortOption = "date"

interface ActivitiesGridWithSortingProps {
  activities: ActivitySummary[]
}

export function ActivitiesGridWithSorting({
  activities,
}: ActivitiesGridWithSortingProps) {
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(
    () => new Set()
  )
  const [pendingProposal, setPendingProposal] =
    useState<BulkActivityUpdateProposal | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [isAwaitingResult, setIsAwaitingResult] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const shouldFocusGridAfterPageChange = useRef(false)
  const fetcher = useFetcher<typeof clientAction>()
  const auth = useAuth()

  const sortParam = searchParams.get("sort")
  const sortOption: ActivitySortOption = isActivitySortOption(sortParam)
    ? sortParam
    : DEFAULT_SORT_OPTION
  const sortedActivities = useMemo(() => {
    markPerformance("activities:sort:start")
    const sorted = sortActivitiesBy(activities, sortOption)
    markPerformance("activities:sort:end")
    measurePerformance(
      "activities:sort",
      "activities:sort:start",
      "activities:sort:end"
    )
    return sorted
  }, [activities, sortOption])
  const totalPages = getActivitiesTotalPages(sortedActivities.length)
  const currentPage = clampActivitiesPage(
    parseActivitiesPage(searchParams.get("page")),
    totalPages
  )
  const pageRange = getActivitiesPageRange(sortedActivities.length, currentPage)
  const pageActivities = useMemo(
    () => sortedActivities.slice(pageRange.start, pageRange.end),
    [pageRange.end, pageRange.start, sortedActivities]
  )
  const pageActivityIds = useMemo(
    () => pageActivities.map((activity) => activity.id),
    [pageActivities]
  )
  const activityById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities]
  )
  const selectedActivities = useMemo(
    () =>
      [...selectedActivityIds]
        .map((activityId) => activityById.get(activityId))
        .filter((activity): activity is ActivitySummary => activity != null),
    [activityById, selectedActivityIds]
  )
  const publicity = commonPublicity(selectedActivities)
  const activityType = commonActivityType(selectedActivities)
  const hasSelection = selectedActivities.length > 0
  const canEditPublicity =
    auth.status === "signedIn" &&
    auth.canSync &&
    selectedActivities.every((activity) => Boolean(activity.contentHash))
  const canEditActivityPublicity = auth.status === "signedIn" && auth.canSync
  const rowPublicityDisabledDescription =
    auth.status === "signedIn" && !auth.canSync
      ? "Publicity editing requires sync access."
      : "Publicity editing requires a synced activity and sync access."

  useEffect(() => {
    const activityIds = new Set(activities.map((activity) => activity.id))
    setSelectedActivityIds((previous) => {
      const next = new Set(
        [...previous].filter((activityId) => activityIds.has(activityId))
      )
      return next.size === previous.size ? previous : next
    })
  }, [activities])

  useEffect(() => {
    const rawPage = searchParams.get("page")
    const normalizedPage = currentPage === 1 ? null : String(currentPage)
    if (rawPage === normalizedPage) return

    setSearchParams(
      (previousSearchParams) => {
        const nextSearchParams = new URLSearchParams(previousSearchParams)
        if (normalizedPage == null) nextSearchParams.delete("page")
        else nextSearchParams.set("page", normalizedPage)
        return nextSearchParams
      },
      { replace: true }
    )
  }, [currentPage, searchParams, setSearchParams])

  useEffect(() => {
    if (!shouldFocusGridAfterPageChange.current) return
    shouldFocusGridAfterPageChange.current = false
    const grid = document.getElementById("activities-grid-anchor")
    if (!(grid instanceof HTMLElement)) return
    grid.focus({ preventScroll: true })
    grid.scrollIntoView({ block: "start" })
  }, [currentPage])

  useEffect(() => {
    if (!isAwaitingResult || fetcher.state !== "idle" || !fetcher.data) return
    if (fetcher.data.ok) {
      setPendingProposal(null)
      setDialogError(null)
    } else {
      setDialogError(fetcher.data.error)
    }
    setIsAwaitingResult(false)
  }, [fetcher.data, fetcher.state, isAwaitingResult])

  const handleSortChange = useCallback(
    (value: string | null) => {
      if (!isActivitySortOption(value)) return

      setSearchParams((previousSearchParams) => {
        const nextSearchParams = new URLSearchParams(previousSearchParams)
        nextSearchParams.set("sort", value)
        nextSearchParams.delete("page")
        return nextSearchParams
      })
    },
    [setSearchParams]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      const nextPage = clampActivitiesPage(page, totalPages)
      if (nextPage === currentPage) return
      shouldFocusGridAfterPageChange.current = true
      setSearchParams((previousSearchParams) => {
        const nextSearchParams = new URLSearchParams(previousSearchParams)
        if (nextPage === 1) nextSearchParams.delete("page")
        else nextSearchParams.set("page", String(nextPage))
        return nextSearchParams
      })
    },
    [currentPage, setSearchParams, totalPages]
  )

  const handleSelectionChange = useCallback(
    (activityId: string, isSelected: boolean) => {
      setSelectedActivityIds((previous) => {
        const next = new Set(previous)
        if (isSelected) next.add(activityId)
        else next.delete(activityId)
        return next
      })
    },
    []
  )

  const isSubmitting = isAwaitingResult || fetcher.state !== "idle"
  const selectAllCurrentPage = useCallback(() => {
    if (isSubmitting) return
    setSelectedActivityIds((previous) => {
      const next = new Set(previous)
      for (const activityId of pageActivityIds) next.add(activityId)
      return next
    })
  }, [isSubmitting, pageActivityIds])

  const clearSelection = useCallback(() => {
    if (isAwaitingResult) return
    setSelectedActivityIds(new Set())
  }, [isAwaitingResult])

  const proposeUpdate = useCallback(
    (proposal: BulkActivityUpdateProposal) => {
      if (isAwaitingResult) return
      setDialogError(null)
      setPendingProposal(proposal)
    },
    [isAwaitingResult]
  )

  const confirmUpdate = useCallback(() => {
    if (!pendingProposal || selectedActivities.length === 0) return
    const formData = new FormData()
    formData.set("intent", "update-activity-settings")
    for (const activity of selectedActivities) {
      formData.append("activityId", activity.id)
    }
    formData.set("setting", pendingProposal.setting)
    formData.set("value", String(pendingProposal.value))
    setIsAwaitingResult(true)
    fetcher.submit(formData, { method: "post" })
  }, [fetcher, pendingProposal, selectedActivities])

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open || isAwaitingResult) return
      setPendingProposal(null)
      setDialogError(null)
    },
    [isAwaitingResult]
  )

  const isCurrentPageFullySelected = pageActivities.every((activity) =>
    selectedActivityIds.has(activity.id)
  )
  const selectedPublicityDisabledDescription =
    auth.status === "signedIn" && !auth.canSync
      ? "Publicity editing requires sync access."
      : "Every selected activity must be synced before publicity can change."

  useLayoutEffect(() => {
    markPerformance("activities:grid:commit")
  })

  return (
    <div>
      <ActivitiesGridWithSortingHeader
        hasSelection={hasSelection}
        selectedActivityCount={selectedActivities.length}
        publicity={publicity}
        activityType={activityType}
        canEditPublicity={canEditPublicity}
        publicityDisabledDescription={selectedPublicityDisabledDescription}
        isSubmitting={isSubmitting}
        isCurrentPageFullySelected={isCurrentPageFullySelected}
        isSelectionDisabled={isSubmitting}
        sortOption={sortOption}
        onSortChange={handleSortChange}
        onSelectAll={selectAllCurrentPage}
        onPublicityChange={(value) => {
          if (publicity !== value) {
            proposeUpdate({ setting: "publicity", value })
          }
        }}
        onActivityTypeChange={(value) => {
          if (value && activityType !== value) {
            proposeUpdate({ setting: "activityType", value })
          }
        }}
        onClearSelection={clearSelection}
      />
      <ActivitiesGrid
        activities={pageActivities}
        selectedActivityIds={selectedActivityIds}
        onSelectionChange={handleSelectionChange}
        showActivitySettings={!hasSelection}
        canEditPublicity={canEditActivityPublicity}
        publicityDisabledDescription={rowPublicityDisabledDescription}
      />
      <ActivitiesPagination
        activityCount={sortedActivities.length}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
      <ConfirmBulkActivityUpdateDialog
        open={pendingProposal != null}
        activityCount={selectedActivities.length}
        proposal={pendingProposal}
        isSubmitting={isSubmitting}
        error={dialogError}
        onOpenChange={handleDialogOpenChange}
        onConfirm={confirmUpdate}
      />
    </div>
  )
}
