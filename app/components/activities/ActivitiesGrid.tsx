import { ActivityCard } from "~/components/public-profile/ActivityCard"
import { ActivityTypeSelectForActivity } from "~/components/activities/ActivityTypeSelect"
import { Grid } from "~/components/Grid"
import type { ParsedActivity } from "~/types/activities"

interface ActivitiesGridProps {
  activities: ParsedActivity[]
}

export function ActivitiesGrid({ activities }: ActivitiesGridProps) {
  return (
    <Grid>
      {activities.map((activity) => (
        <ActivityCard
          key={activity.id}
          activity={{
            name: activity.name,
            startedAtMs: activity.startedAtMs,
            distanceKm: activity.stats.distanceKm,
            durationMs: activity.stats.durationMs,
            elevationGainM: activity.stats.elevationGainM,
            avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
          }}
          activityHref={`/map?activity=${activity.id}`}
          activityTypeControl={
            <ActivityTypeSelectForActivity
              activityId={activity.id}
              activityName={activity.name}
              activityType={activity.activityType}
            />
          }
        />
      ))}
    </Grid>
  )
}
