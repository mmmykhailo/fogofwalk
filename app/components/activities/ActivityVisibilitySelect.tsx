import { useFetcher } from "react-router"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import type { clientAction } from "~/routes/activities"
import { canSync, useAuth } from "~/lib/server/authStore"
import type { ParsedActivity } from "~/types/activities"

interface ActivityVisibilitySelectProps {
  activity: ParsedActivity
}

export function ActivityVisibilitySelect({
  activity,
}: ActivityVisibilitySelectProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const auth = useAuth()
  const isAvailable = canSync() && activity.contentHash != null
  const pendingValue = fetcher.formData?.get("value")
  const isPublic =
    pendingValue === "true" || pendingValue === "false"
      ? pendingValue === "true"
      : (activity.isPublic ?? false)

  function handleChange(nextIsPublic: boolean) {
    if (!isAvailable || nextIsPublic === isPublic) return
    const formData = new FormData()
    formData.set("intent", "update-activity-settings")
    formData.set("activityId", activity.id)
    formData.set("setting", "publicity")
    formData.set("value", String(nextIsPublic))
    fetcher.submit(formData, { method: "post" })
  }

  const unavailableDescription =
    auth.status === "signedIn" && !auth.canSync
      ? "Publicity editing requires sync access."
      : "Publicity editing requires a synced activity and sync access."

  return (
    <VisibilitySelect
      isPublic={isPublic}
      onChange={handleChange}
      disabled={!isAvailable || fetcher.state !== "idle"}
      disabledDescription={!isAvailable ? unavailableDescription : undefined}
      ariaLabel={`Publicity for ${activity.name}`}
      id={`activity-visibility-${activity.id}`}
    />
  )
}
