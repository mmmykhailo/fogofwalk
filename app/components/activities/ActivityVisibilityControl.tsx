import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { useActivityMetadataMutation } from "~/lib/useActivityMetadataMutation"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivityVisibilityControlProps {
  activity: ActivitySummary
  canEdit: boolean
  disabledDescription?: string
}

/** Visibility-only view of the shared optimistic activity metadata control. */
export function ActivityVisibilityControl({
  activity,
  canEdit,
  disabledDescription,
}: ActivityVisibilityControlProps) {
  const mutation = useActivityMetadataMutation(activity)
  const available = canEdit && Boolean(activity.contentHash)
  const errorId = `activity-visibility-error-${activity.id}`

  return (
    <div className="flex flex-col gap-1">
      <VisibilitySelect
        isPublic={mutation.isPublic}
        onChange={mutation.changeVisibility}
        disabled={!available}
        disabledDescription={!available ? disabledDescription : undefined}
        ariaLabel={`Visibility for ${activity.name}`}
        ariaDescribedBy={mutation.error ? errorId : undefined}
      />
      {mutation.error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {mutation.error}
        </p>
      )}
    </div>
  )
}
