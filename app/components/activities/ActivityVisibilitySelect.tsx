import { useFetcher } from "react-router"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import type { clientAction } from "~/routes/activities"
import { canSync, getAuthState } from "~/lib/server/authStore"
import type { ParsedActivity } from "~/types/activities"

interface ActivityVisibilitySelectProps {
  activity: ParsedActivity
  canEditPublicity?: boolean
  publicityDisabledDescription?: string
}

export function ActivityVisibilitySelect({
  activity,
  canEditPublicity,
  publicityDisabledDescription,
}: ActivityVisibilitySelectProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const isAvailable =
    (canEditPublicity ?? canSync()) && Boolean(activity.contentHash)
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
    publicityDisabledDescription ??
    (getAuthState().status === "signedIn" && !canSync()
      ? "Publicity editing requires sync access."
      : "Publicity editing requires a synced activity and sync access.")

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
