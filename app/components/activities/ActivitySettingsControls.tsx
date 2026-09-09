import { useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { ActivityTypeSelect } from "~/components/activities/ActivityTypeSelect"
import { isActivityType } from "~/lib/activityType"
import {
  createActivitySettingsFormData,
  type ActivitySettingUpdate,
} from "~/lib/activitySettings"
import type { clientAction } from "~/routes/activities"
import type { ActivityType } from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"

interface ActivitySettingsControlsProps {
  activity: ActivitySummary
  canEditVisibility: boolean
  visibilityDisabledDescription: string
}

export function ActivitySettingsControls({
  activity,
  canEditVisibility,
  visibilityDisabledDescription,
}: ActivitySettingsControlsProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const [error, setError] = useState<string | null>(null)
  const isAwaitingResult = useRef(false)
  const isPending = fetcher.state !== "idle"
  const pendingSetting = isPending ? fetcher.formData?.get("setting") : null
  const pendingValue = isPending ? fetcher.formData?.get("value") : null
  const pendingType =
    pendingSetting === "activityType" && isActivityType(pendingValue)
      ? pendingValue
      : null
  const pendingVisibility =
    pendingSetting === "visibility" &&
    (pendingValue === "true" || pendingValue === "false")
      ? pendingValue === "true"
      : null
  const visibilityAvailable = canEditVisibility && Boolean(activity.contentHash)
  const errorId = `activity-settings-error-${activity.id}`

  useEffect(() => {
    if (!isAwaitingResult.current || fetcher.state !== "idle") return
    if (!fetcher.data) return
    setError(fetcher.data.ok ? null : fetcher.data.error)
    isAwaitingResult.current = false
  }, [fetcher.data, fetcher.state])

  function submitSetting(update: ActivitySettingUpdate) {
    setError(null)
    isAwaitingResult.current = true
    fetcher.submit(createActivitySettingsFormData(update), { method: "post" })
  }

  function handleVisibilityChange(nextIsPublic: boolean) {
    const currentValue = pendingVisibility ?? activity.isPublic ?? false
    if (!visibilityAvailable || nextIsPublic === currentValue) return
    submitSetting({
      activityIds: [activity.id],
      setting: "visibility",
      value: nextIsPublic,
    })
  }

  function handleTypeChange(nextType: ActivityType | null) {
    const currentValue = pendingType ?? activity.activityType
    if (!nextType || nextType === currentValue) return
    submitSetting({
      activityIds: [activity.id],
      setting: "activityType",
      value: nextType,
    })
  }

  return (
    <div className="flex flex-col flex-wrap items-center justify-end gap-2 @sm:flex-row">
      <VisibilitySelect
        isPublic={pendingVisibility ?? activity.isPublic ?? false}
        onChange={handleVisibilityChange}
        disabled={!visibilityAvailable || isPending}
        disabledDescription={
          !visibilityAvailable ? visibilityDisabledDescription : undefined
        }
        ariaLabel={`Visibility for ${activity.name}`}
        ariaDescribedBy={error ? errorId : undefined}
        id={`activity-visibility-${activity.id}`}
      />
      <ActivityTypeSelect
        activityType={pendingType ?? activity.activityType}
        onChange={handleTypeChange}
        disabled={isPending}
        ariaLabel={`Activity type for ${activity.name}`}
        ariaDescribedBy={error ? errorId : undefined}
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="w-full text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  )
}
