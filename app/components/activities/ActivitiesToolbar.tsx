import { ActivityTypeSelect } from "~/components/activities/ActivityTypeSelect"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { Button } from "~/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import type { ActivityType } from "~/types/activities"
import {
  ACTIVITY_SORT_OPTIONS,
  type ActivitySortOption,
} from "~/lib/statsAggregator"
import {
  MIXED_ACTIVITY_TYPE,
  MIXED_VISIBILITY,
  type CommonActivityType,
  type CommonVisibility,
} from "~/lib/activitySettings"
import { isActivityType } from "~/lib/activityType"

const sortLabels = {
  distance: "Distance",
  speed: "Speed",
  duration: "Duration",
  elevationGain: "Elevation gain",
  date: "Date",
} satisfies Record<ActivitySortOption, string>

interface ActivitiesToolbarProps {
  hasSelection: boolean
  selectedActivityCount: number
  visibility: CommonVisibility
  activityType: CommonActivityType
  canEditVisibility: boolean
  visibilityDisabledDescription: string
  isSubmitting: boolean
  isCurrentPageFullySelected: boolean
  isSelectionDisabled: boolean
  sortOption: ActivitySortOption
  onSortChange: (value: string | null) => void
  onSelectAll: () => void
  onPublicityChange: (value: boolean) => void
  onActivityTypeChange: (value: ActivityType | null) => void
  onClearSelection: () => void
}

export function ActivitiesToolbar({
  hasSelection,
  selectedActivityCount,
  visibility,
  activityType,
  canEditVisibility,
  visibilityDisabledDescription,
  isSubmitting,
  isCurrentPageFullySelected,
  isSelectionDisabled,
  sortOption,
  onSortChange,
  onSelectAll,
  onPublicityChange,
  onActivityTypeChange,
  onClearSelection,
}: ActivitiesToolbarProps) {
  const selectAllButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={isCurrentPageFullySelected || isSelectionDisabled}
      onClick={onSelectAll}
      title="Select all activities on this page"
    >
      Select all
    </Button>
  )

  return (
    <div className="sticky top-0 -mx-4 mb-px flex flex-wrap items-center justify-end gap-2 bg-background px-4 py-4">
      {hasSelection ? (
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            Selected {selectedActivityCount}{" "}
            {selectedActivityCount === 1 ? "activity" : "activities"}
          </span>
          <VisibilitySelect
            isPublic={visibility === true}
            mixed={visibility === MIXED_VISIBILITY}
            onChange={onPublicityChange}
            disabled={!canEditVisibility || isSubmitting}
            disabledDescription={
              !canEditVisibility ? visibilityDisabledDescription : undefined
            }
            ariaLabel="Set visibility for selected activities"
            id="bulk-activity-visibility"
          />
          <ActivityTypeSelect
            activityType={
              isActivityType(activityType) ? activityType : undefined
            }
            mixed={activityType === MIXED_ACTIVITY_TYPE}
            onChange={onActivityTypeChange}
            disabled={isSubmitting}
            ariaLabel="Set activity type for selected activities"
          />
          {selectAllButton}
          <Button
            variant="outline"
            size="sm"
            disabled={isSubmitting}
            onClick={onClearSelection}
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
          <Select value={sortOption} onValueChange={onSortChange}>
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
          {selectAllButton}
        </>
      )}
    </div>
  )
}
