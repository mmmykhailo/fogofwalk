import { LocalActivityCard } from "~/components/activities/LocalActivityCard"
import { Grid } from "~/components/Grid"
import type { ActivitySummary } from "~/types/activitySummary"
import type { ActivityMetadataValue } from "~/lib/useActivityMetadataMutation"

interface ActivitiesGridProps {
  activities: ActivitySummary[]
  selectedActivityIds: ReadonlySet<string>
  onSelectionChange: (activityId: string, isSelected: boolean) => void
  showActivitySettings: boolean
  canEditVisibility: boolean
  visibilityDisabledDescription: string
  onMetadataOptimisticChange?: (
    activityId: string,
    value: ActivityMetadataValue
  ) => void
  onMetadataSuccess?: (activityId: string, value: ActivityMetadataValue) => void
  onMetadataFailure?: (activityId: string) => void
}

export function ActivitiesGrid({
  activities,
  selectedActivityIds,
  onSelectionChange,
  showActivitySettings,
  canEditVisibility,
  visibilityDisabledDescription,
  onMetadataOptimisticChange,
  onMetadataSuccess,
  onMetadataFailure,
}: ActivitiesGridProps) {
  return (
    <Grid
      data-testid="activities-grid"
      id="activities-grid-anchor"
      tabIndex={-1}
      className="scroll-mt-24"
    >
      {activities.map((activity) => (
        <LocalActivityCard
          key={activity.id}
          activity={activity}
          isSelected={selectedActivityIds.has(activity.id)}
          showActivitySettings={showActivitySettings}
          canEditVisibility={canEditVisibility}
          visibilityDisabledDescription={visibilityDisabledDescription}
          onSelectionChange={onSelectionChange}
          onMetadataOptimisticChange={onMetadataOptimisticChange}
          onMetadataSuccess={onMetadataSuccess}
          onMetadataFailure={onMetadataFailure}
        />
      ))}
    </Grid>
  )
}
