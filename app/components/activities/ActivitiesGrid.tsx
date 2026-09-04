import { ActivityCard } from "~/components/public-profile/ActivityCard"
import { ActivitySettingsControls } from "~/components/activities/ActivitySettingsControls"
import { Checkbox } from "~/components/ui/checkbox"
import { Grid } from "~/components/Grid"
import type { ParsedActivity } from "~/types/activities"

interface ActivitiesGridProps {
  activities: ParsedActivity[]
  selectedActivityIds: ReadonlySet<string>
  onSelectionChange: (activityId: string, isSelected: boolean) => void
  showActivitySettings: boolean
}

export function ActivitiesGrid({
  activities,
  selectedActivityIds,
  onSelectionChange,
  showActivitySettings,
}: ActivitiesGridProps) {
  return (
    <Grid>
      {activities.map((activity) => {
        const isSelected = selectedActivityIds.has(activity.id)
        return (
          <ActivityCard
            key={activity.id}
            activityId={activity.id}
            activity={{
              name: activity.name,
              startedAtMs: activity.startedAtMs,
              distanceKm: activity.stats.distanceKm,
              durationMs: activity.stats.durationMs,
              elevationGainM: activity.stats.elevationGainM,
              avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
            }}
            activityHref={`/map?activity=${activity.id}`}
            selectionControl={
              <span
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) =>
                    onSelectionChange(activity.id, checked)
                  }
                  aria-label={`Select activity ${activity.name}`}
                />
              </span>
            }
            settingsControls={
              showActivitySettings ? (
                <ActivitySettingsControls activity={activity} />
              ) : undefined
            }
          />
        )
      })}
    </Grid>
  )
}
