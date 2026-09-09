import { LocalActivityCard } from "~/components/activities/LocalActivityCard"
import { Grid } from "~/components/Grid"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivitiesGridProps {
  activities: ActivitySummary[]
  selectedActivityIds: ReadonlySet<string>
  onSelectionChange: (activityId: string, isSelected: boolean) => void
  showActivitySettings: boolean
  canEditVisibility: boolean
  visibilityDisabledDescription: string
}

export function ActivitiesGrid({
  activities,
  selectedActivityIds,
  onSelectionChange,
  showActivitySettings,
  canEditVisibility,
  visibilityDisabledDescription,
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
        />
      ))}
    </Grid>
  )
}
