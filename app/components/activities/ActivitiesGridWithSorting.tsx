import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
import {
  ACTIVITY_SORT_OPTIONS,
  isActivitySortOption,
  sortActivitiesBy,
  type ActivitySortOption,
} from "~/lib/statsAggregator"
import type { ParsedActivity } from "~/types/activities"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"

const DEFAULT_SORT_OPTION: ActivitySortOption = "date"

const sortLabels = {
  distance: "Distance",
  speed: "Speed",
  duration: "Duration",
  elevationGain: "Elevation gain",
  date: "Date",
} satisfies Record<ActivitySortOption, string>

interface ActivitiesGridWithSortingProps {
  activities: ParsedActivity[]
}

export function ActivitiesGridWithSorting({
  activities,
}: ActivitiesGridWithSortingProps) {
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(
    () => new Set()
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const sortParam = searchParams.get("sort")
  const sortOption: ActivitySortOption = isActivitySortOption(sortParam)
    ? sortParam
    : DEFAULT_SORT_OPTION
  const sortedActivities = useMemo(
    () => sortActivitiesBy(activities, sortOption),
    [activities, sortOption]
  )
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

  useEffect(() => {
    const activityIds = new Set(activities.map((activity) => activity.id))
    setSelectedActivityIds((previous) => {
      const next = new Set(
        [...previous].filter((activityId) => activityIds.has(activityId))
      )
      return next.size === previous.size ? previous : next
    })
  }, [activities])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
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
      </div>
      <ActivitiesGrid
        activities={sortedActivities}
        selectedActivityIds={selectedActivityIds}
        onSelectionChange={handleSelectionChange}
        showActivitySettings
      />
    </div>
  )
}
