import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"
import { useFetcher, useSearchParams } from "react-router"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
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
import type { ParsedActivity } from "~/types/activities"
import type { clientAction } from "~/routes/activities"
import { markPerformance, measurePerformance } from "~/lib/performance"

const DEFAULT_SORT_OPTION: ActivitySortOption = "date"

interface ActivitiesGridWithSortingProps {
  activities: ParsedActivity[]
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
  const activityById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities]
  )
  const selectedActivities = useMemo(
    () =>
      [...selectedActivityIds]
        .map((activityId) => activityById.get(activityId))
        .filter((activity): activity is ParsedActivity => activity != null),
    [activityById, selectedActivityIds]
  )
  const publicity = commonPublicity(selectedActivities)
  const activityType = commonActivityType(selectedActivities)
  const hasSelection = selectedActivities.length > 0
  const canEditPublicity =
    auth.status === "signedIn" &&
    auth.canSync &&
    selectedActivities.every((activity) => Boolean(activity.contentHash))

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
        return nextSearchParams
      })
    },
    [setSearchParams]
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

  const isSubmitting = isAwaitingResult || fetcher.state !== "idle"
  const publicityDisabledDescription =
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
        publicityDisabledDescription={publicityDisabledDescription}
        isSubmitting={isSubmitting}
        sortOption={sortOption}
        onSortChange={handleSortChange}
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
        activities={sortedActivities}
        selectedActivityIds={selectedActivityIds}
        onSelectionChange={handleSelectionChange}
        showActivitySettings={!hasSelection}
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
