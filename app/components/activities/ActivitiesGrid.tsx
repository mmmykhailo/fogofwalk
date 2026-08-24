import { ActivityCard } from "~/components/public-profile/ActivityCard"
import type { ParsedActivity } from "~/types/activities"

interface ActivitiesGridProps {
  activities: ParsedActivity[]
}

export function ActivitiesGrid({ activities }: ActivitiesGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        />
      ))}
    </div>
  )
}
