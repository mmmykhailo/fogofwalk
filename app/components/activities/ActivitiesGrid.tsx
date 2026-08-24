import { ActivityCard } from "~/components/public-profile/ActivityCard"
import { ActivityTypeSelect } from "~/components/activities/ActivityTypeSelect"
import type { ParsedActivity } from "~/types/activities"

interface ActivitiesGridProps {
  activities: ParsedActivity[]
}

export function ActivitiesGrid({ activities }: ActivitiesGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4">
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
          activityHref={`/?activity=${activity.id}`}
          activityTypeControl={
            <ActivityTypeSelect
              activityId={activity.id}
              activityName={activity.name}
              activityType={activity.activityType}
            />
          }
        />
      ))}
    </div>
  )
}
