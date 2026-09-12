import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { ActivityTypeSelect } from "~/components/activities/ActivityTypeSelect"
import {
  useActivityMetadataMutation,
  type ActivityMetadataValue,
} from "~/lib/useActivityMetadataMutation"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivitySettingsControlsProps {
  activity: ActivitySummary
  canEditVisibility: boolean
  visibilityDisabledDescription: string
  onOptimisticChange?: (value: ActivityMetadataValue) => void
  onSuccess?: (value: ActivityMetadataValue) => void
  onFailure?: () => void
}

export function ActivitySettingsControls({
  activity,
  canEditVisibility,
  visibilityDisabledDescription,
  onOptimisticChange,
  onSuccess,
  onFailure,
}: ActivitySettingsControlsProps) {
  const mutation = useActivityMetadataMutation(activity, {
    onOptimisticChange,
    onSuccess,
    onFailure,
  })
  const visibilityAvailable = canEditVisibility && Boolean(activity.contentHash)
  const errorId = `activity-settings-error-${activity.id}`

  return (
    <div className="flex flex-col flex-wrap items-center justify-end gap-2 @sm:flex-row">
      <VisibilitySelect
        isPublic={mutation.isPublic}
        onChange={(nextIsPublic) => {
          if (visibilityAvailable) mutation.changeVisibility(nextIsPublic)
        }}
        disabled={!visibilityAvailable}
        disabledDescription={
          !visibilityAvailable ? visibilityDisabledDescription : undefined
        }
        ariaLabel={`Visibility for ${activity.name}`}
        ariaDescribedBy={mutation.error ? errorId : undefined}
        id={`activity-visibility-${activity.id}`}
      />
      <ActivityTypeSelect
        activityType={mutation.activityType}
        onChange={mutation.changeActivityType}
        ariaLabel={`Activity type for ${activity.name}`}
        ariaDescribedBy={mutation.error ? errorId : undefined}
      />
      {mutation.error && (
        <p
          id={errorId}
          role="alert"
          className="w-full text-xs text-destructive"
        >
          {mutation.error}
        </p>
      )}
    </div>
  )
}
