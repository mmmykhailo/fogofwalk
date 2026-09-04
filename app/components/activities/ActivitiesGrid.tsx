import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import { LocalActivityCard } from "~/components/activities/LocalActivityCard"
import { Grid } from "~/components/Grid"
import type { ActivitySummary } from "~/types/activitySummary"

export const ACTIVITIES_PAGE_SIZE = 48

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
  const [visibleCount, setVisibleCount] = useState(ACTIVITIES_PAGE_SIZE)
  useEffect(() => {
    setVisibleCount(ACTIVITIES_PAGE_SIZE)
  }, [activities])

  const visibleActivities = activities.slice(0, visibleCount)
  const remainingCount = activities.length - visibleActivities.length

  return (
    <>
      <Grid data-testid="activities-grid">
        {visibleActivities.map((activity) => (
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
      <div
        className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span>
          Showing {visibleActivities.length} of {activities.length} activities.
          {remainingCount > 0 ? ` ${remainingCount} remaining.` : ""}
        </span>
        {remainingCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setVisibleCount((count) =>
                Math.min(count + ACTIVITIES_PAGE_SIZE, activities.length)
              )
            }
          >
            Load more activities
          </Button>
        )}
      </div>
    </>
  )
}
