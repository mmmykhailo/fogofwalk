import { useCallback, useEffect, useMemo, useState } from "react"
import { useFetcher, useSearchParams } from "react-router"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
import { ActivityTypeSelect } from "~/components/activities/ActivityTypeSelect"
import { ConfirmBulkActivityUpdateDialog } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import type { BulkActivityUpdateProposal } from "~/components/activities/ConfirmBulkActivityUpdateDialog"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { Button } from "~/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { isActivityType } from "~/lib/activityType"
import {
  ACTIVITY_SORT_OPTIONS,
  isActivitySortOption,
  sortActivitiesBy,
  type ActivitySortOption,
} from "~/lib/statsAggregator"
import {
  commonActivityType,
  commonPublicity,
  MIXED_ACTIVITY_TYPE,
  MIXED_PUBLICITY,
  NO_ACTIVITY_SELECTION,
  UNSET_ACTIVITY_TYPE,
} from "~/lib/activitySettings"
import { useAuth } from "~/lib/server/authStore"
import type { ParsedActivity } from "~/types/activities"
import type { clientAction } from "~/routes/activities"

const DEFAULT_SORT_OPTION: ActivitySortOption = "date"

const sortLabels = {
  distance: "Distance",
  speed: "Speed",
  duration: "Duration",
  elevationGain: "Elevation gain",
  date: "Date",
} satisfies Record<ActivitySortOption, string>

interface ActivitiesGridWithSortingHeaderProps {
  activities: ParsedActivity[]
}

export function ActivitiesGridWithSortingHeader({
  activities,
}: ActivitiesGridWithSortingHeaderProps) {
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
  const sortedActivities = useMemo(
    () => sortActivitiesBy(activities, sortOption),
    [activities, sortOption]
  )
  const selectedActivities = useMemo(
    () => activities.filter((activity) => selectedActivityIds.has(activity.id)),
    [activities, selectedActivityIds]
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasSelection ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              Selected {selectedActivities.length}{" "}
              {selectedActivities.length === 1 ? "activity" : "activities"}
            </span>
            <VisibilitySelect
              isPublic={publicity === true}
              mixed={publicity === MIXED_PUBLICITY}
              onChange={(value) => {
                if (publicity !== value) {
                  proposeUpdate({ setting: "publicity", value })
                }
              }}
              disabled={!canEditPublicity || isSubmitting}
              disabledDescription={
                !canEditPublicity ? publicityDisabledDescription : undefined
              }
              ariaLabel="Set publicity for selected activities"
              id="bulk-activity-visibility"
            />
            <ActivityTypeSelect
              activityType={
                isActivityType(activityType) ? activityType : undefined
              }
              mixed={activityType === MIXED_ACTIVITY_TYPE}
              onChange={(value) => {
                if (value && activityType !== value) {
                  proposeUpdate({ setting: "activityType", value })
                }
              }}
              disabled={isSubmitting}
              ariaLabel="Set activity type for selected activities"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={clearSelection}
            >
              Clear selection
            </Button>
          </>
        ) : (
          <>
            <label
              htmlFor="activity-sort"
              className="text-xs text-muted-foreground"
            >
              Sort by
            </label>
            <Select value={sortOption} onValueChange={handleSortChange}>
              <SelectTrigger id="activity-sort" size="sm" className="bg-muted">
                <SelectValue>
                  {(value: ActivitySortOption) => sortLabels[value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {ACTIVITY_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {sortLabels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
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
