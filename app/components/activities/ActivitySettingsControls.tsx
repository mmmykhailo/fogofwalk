import { ActivityTypeSelectForActivity } from "~/components/activities/ActivityTypeSelect"
import { ActivityVisibilitySelect } from "~/components/activities/ActivityVisibilitySelect"
import type { ParsedActivity } from "~/types/activities"

interface ActivitySettingsControlsProps {
  activity: ParsedActivity
}

export function ActivitySettingsControls({
  activity,
}: ActivitySettingsControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ActivityVisibilitySelect activity={activity} />
      <ActivityTypeSelectForActivity
        activityId={activity.id}
        activityName={activity.name}
        activityType={activity.activityType}
      />
    </div>
  )
}
