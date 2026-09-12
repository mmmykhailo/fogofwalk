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
import { ActivitiesToolbar } from "~/components/activities/ActivitiesToolbar"
import { ConfirmBulkActivityUpdateDialog } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import type { BulkActivityUpdateProposal } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import { isActivitySortOption, sortActivitiesBy } from "~/lib/statsAggregator"
import {
  commonActivityType,
  commonVisibility,
  createActivitySettingsFormData,
} from "~/lib/activitySettings"
import { useAuth } from "~/lib/server/authStore"
import type { ActivitySummary } from "~/types/activitySummary"
import type { ActivityMetadataValue } from "~/lib/useActivityMetadataMutation"
import type { clientAction } from "~/routes/activities"
import {
  markPerformance,
  measurePerformanceDuration,
  performanceNow,
} from "~/lib/performance"
import {
  clampActivitiesPage,
  getCanonicalActivitiesQuery,
  getActivitiesPageRange,
  getActivitiesTotalPages,
} from "~/lib/activitiesRoute"

interface ActivityLibraryProps {
  activities: ActivitySummary[]
}

export function ActivityLibrary({ activities }: ActivityLibraryProps) {
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(
    () => new Set()
  )
  const [pendingProposal, setPendingProposal] =
    useState<BulkActivityUpdateProposal | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [isAwaitingResult, setIsAwaitingResult] = useState(false)
  const bulkRollbackRef = useRef<Map<string, ActivityMetadataValue> | null>(
    null
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const shouldFocusGridAfterPageChange = useRef(false)
  const didMarkFirstGridCommit = useRef(false)
  const fetcher = useFetcher<typeof clientAction>()
  const auth = useAuth()
  const [optimisticMetadata, setOptimisticMetadata] = useState<
    Map<string, ActivityMetadataValue>
  >(() => new Map())

  const sortOption = getCanonicalActivitiesQuery(searchParams).sortOption
  const displayedActivities = useMemo(
    () =>
      activities.map((activity) => {
        const optimistic = optimisticMetadata.get(activity.id)
        if (!optimistic) return activity
        return {
          ...activity,
          isPublic: optimistic.isPublic,
          ...(optimistic.activityType !== undefined
            ? { activityType: optimistic.activityType }
            : {}),
        }
      }),
    [activities, optimisticMetadata]
  )
  const sortedActivities = useMemo(
    () => sortActivitiesBy(displayedActivities, sortOption),
    [displayedActivities, sortOption]
  )

  useEffect(() => {
    const startedAt = performanceNow()
    if (startedAt == null) return
    sortActivitiesBy(activities, sortOption)
    const finishedAt = performanceNow()
    if (finishedAt != null) {
      measurePerformanceDuration(
        "activities:sort",
        Math.max(0, finishedAt - startedAt)
      )
    }
  }, [activities, sortOption])
  const totalPages = getActivitiesTotalPages(sortedActivities.length)
  const canonicalQuery = getCanonicalActivitiesQuery(searchParams, totalPages)
  const currentPage = canonicalQuery.page
  const currentSearch = searchParams.toString()
  const canonicalSearch = canonicalQuery.searchParams.toString()
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
    () =>
      new Map(displayedActivities.map((activity) => [activity.id, activity])),
    [displayedActivities]
  )
  const selectedActivities = useMemo(
    () =>
      [...selectedActivityIds]
        .map((activityId) => activityById.get(activityId))
        .filter((activity): activity is ActivitySummary => activity != null),
    [activityById, selectedActivityIds]
  )
  const visibility = commonVisibility(selectedActivities)
  const activityType = commonActivityType(selectedActivities)
  const hasSelection = selectedActivities.length > 0
  const canEditVisibility =
    auth.status === "signedIn" &&
    auth.canSync &&
    selectedActivities.every((activity) => Boolean(activity.contentHash))
  const canEditActivityVisibility = auth.status === "signedIn" && auth.canSync
  const rowVisibilityDisabledDescription =
    auth.status === "signedIn" && !auth.canSync
      ? "Visibility editing requires sync access."
      : "Visibility editing requires a synced activity and sync access."

  const canonicalActivityById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities]
  )

  const handleMetadataOptimisticChange = useCallback(
    (activityId: string, value: ActivityMetadataValue) => {
      setOptimisticMetadata((previous) => {
        const next = new Map(previous)
        next.set(activityId, value)
        return next
      })
    },
    []
  )

  const handleMetadataSuccess = useCallback(
    (activityId: string, value: ActivityMetadataValue) => {
      const canonical = canonicalActivityById.get(activityId)
      if (
        !canonical ||
        (canonical.isPublic ?? false) !== value.isPublic ||
        (value.activityType !== undefined &&
          canonical.activityType !== value.activityType)
      ) {
        return
      }
      setOptimisticMetadata((previous) => {
        if (!previous.has(activityId)) return previous
        const next = new Map(previous)
        next.delete(activityId)
        return next
      })
    },
    [canonicalActivityById]
  )

  const handleMetadataFailure = useCallback((activityId: string) => {
    setOptimisticMetadata((previous) => {
      if (!previous.has(activityId)) return previous
      const next = new Map(previous)
      next.delete(activityId)
      return next
    })
  }, [])

  useEffect(() => {
    setOptimisticMetadata((previous) => {
      let next: Map<string, ActivityMetadataValue> | null = null
      for (const [activityId, value] of previous) {
        const canonical = canonicalActivityById.get(activityId)
        if (
          canonical &&
          (canonical.isPublic ?? false) === value.isPublic &&
          (value.activityType === undefined ||
            canonical.activityType === value.activityType)
        ) {
          next ??= new Map(previous)
          next.delete(activityId)
        }
      }
      return next ?? previous
    })
  }, [canonicalActivityById])

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
    if (canonicalSearch === currentSearch) return

    setSearchParams(canonicalSearch, { replace: true })
  }, [canonicalSearch, currentSearch, setSearchParams])

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
      bulkRollbackRef.current = null
    } else {
      const rollback = bulkRollbackRef.current
      if (rollback) {
        setOptimisticMetadata((previous) => {
          const next = new Map(previous)
          for (const [activityId, value] of rollback) {
            next.set(activityId, value)
          }
          return next
        })
      }
      setDialogError(fetcher.data.error)
      bulkRollbackRef.current = null
    }
    setIsAwaitingResult(false)
  }, [fetcher.data, fetcher.state, isAwaitingResult])

  const handleSortChange = useCallback(
    (value: string | null) => {
      if (!isActivitySortOption(value) || value === sortOption) return

      setSearchParams(
        (previousSearchParams) => {
          const nextSearchParams = getCanonicalActivitiesQuery(
            previousSearchParams,
            totalPages
          ).searchParams
          nextSearchParams.set("sort", value)
          nextSearchParams.delete("page")
          return nextSearchParams
        },
        { replace: false }
      )
    },
    [setSearchParams, sortOption, totalPages]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      const nextPage = clampActivitiesPage(page, totalPages)
      if (nextPage === currentPage) return
      shouldFocusGridAfterPageChange.current = true
      setSearchParams(
        (previousSearchParams) => {
          const nextSearchParams = getCanonicalActivitiesQuery(
            previousSearchParams,
            totalPages
          ).searchParams
          if (nextPage === 1) nextSearchParams.delete("page")
          else nextSearchParams.set("page", String(nextPage))
          return nextSearchParams
        },
        { replace: false }
      )
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
    const rollback = new Map<string, ActivityMetadataValue>()
    const nextValues = new Map<string, ActivityMetadataValue>()
    for (const activity of selectedActivities) {
      const current: ActivityMetadataValue = {
        isPublic: activity.isPublic ?? false,
        ...(activity.activityType
          ? { activityType: activity.activityType }
          : {}),
      }
      rollback.set(activity.id, current)
      nextValues.set(
        activity.id,
        pendingProposal.setting === "visibility"
          ? { ...current, isPublic: pendingProposal.value }
          : { ...current, activityType: pendingProposal.value }
      )
    }
    bulkRollbackRef.current = rollback
    setOptimisticMetadata((previous) => {
      const next = new Map(previous)
      for (const [activityId, value] of nextValues) {
        next.set(activityId, value)
      }
      return next
    })
    setIsAwaitingResult(true)
    fetcher.submit(
      createActivitySettingsFormData({
        activityIds: selectedActivities.map((activity) => activity.id),
        ...pendingProposal,
      }),
      { method: "post" }
    )
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
  const selectedVisibilityDisabledDescription =
    auth.status === "signedIn" && !auth.canSync
      ? "Visibility editing requires sync access."
      : "Every selected activity must be synced before publicity can change."

  useLayoutEffect(() => {
    if (didMarkFirstGridCommit.current) return
    didMarkFirstGridCommit.current = true
    markPerformance("activities:grid:commit")
  }, [])

  return (
    <div>
      <ActivitiesToolbar
        hasSelection={hasSelection}
        selectedActivityCount={selectedActivities.length}
        visibility={visibility}
        activityType={activityType}
        canEditVisibility={canEditVisibility}
        visibilityDisabledDescription={selectedVisibilityDisabledDescription}
        isSubmitting={isSubmitting}
        isCurrentPageFullySelected={isCurrentPageFullySelected}
        isSelectionDisabled={isSubmitting}
        sortOption={sortOption}
        onSortChange={handleSortChange}
        onSelectAll={selectAllCurrentPage}
        onPublicityChange={(value) => {
          if (visibility !== value) {
            proposeUpdate({ setting: "visibility", value })
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
        canEditVisibility={canEditActivityVisibility}
        visibilityDisabledDescription={rowVisibilityDisabledDescription}
        onMetadataOptimisticChange={handleMetadataOptimisticChange}
        onMetadataSuccess={handleMetadataSuccess}
        onMetadataFailure={handleMetadataFailure}
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
