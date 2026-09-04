import { LocalActivityCard } from "~/components/activities/LocalActivityCard"
import { Grid } from "~/components/Grid"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivitiesGridProps {
  activities: ActivitySummary[]
  selectedActivityIds: ReadonlySet<string>
  onSelectionChange: (activityId: string, isSelected: boolean) => void
  showActivitySettings: boolean
  canEditPublicity: boolean
  publicityDisabledDescription: string
}

export function ActivitiesGrid({
  activities,
  selectedActivityIds,
  onSelectionChange,
  showActivitySettings,
  canEditPublicity,
  publicityDisabledDescription,
}: ActivitiesGridProps) {
  return (
    <Grid
      data-testid="activities-grid"
      id="activities-grid-anchor"
      tabIndex={-1}
    >
      {activities.map((activity) => (
        <LocalActivityCard
          key={activity.id}
          activity={activity}
          isSelected={selectedActivityIds.has(activity.id)}
          showActivitySettings={showActivitySettings}
          canEditPublicity={canEditPublicity}
          publicityDisabledDescription={publicityDisabledDescription}
          onSelectionChange={onSelectionChange}
        />
      ))}
    </Grid>
  )
}
