import { ActivityTypeSelectForActivity } from "~/components/activities/ActivityTypeSelect"
import { ActivityVisibilitySelect } from "~/components/activities/ActivityVisibilitySelect"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivitySettingsControlsProps {
  activity: ActivitySummary
  canEditPublicity: boolean
  publicityDisabledDescription: string
}

export function ActivitySettingsControls({
  activity,
  canEditPublicity,
  publicityDisabledDescription,
}: ActivitySettingsControlsProps) {
  return (
    <div className="flex flex-col flex-wrap items-center justify-end gap-2 @sm:flex-row">
      <ActivityVisibilitySelect
        activity={activity}
        canEditPublicity={canEditPublicity}
        publicityDisabledDescription={publicityDisabledDescription}
      />
      <ActivityTypeSelectForActivity
        activityId={activity.id}
        activityName={activity.name}
        activityType={activity.activityType}
      />
    </div>
  )
}
