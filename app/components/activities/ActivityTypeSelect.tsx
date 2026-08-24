import { useFetcher } from "react-router"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { ACTIVITY_TYPE_LABELS, isActivityType } from "~/lib/activityType"
import { ACTIVITY_TYPES, type ActivityType } from "~/types/activities"
import type { clientAction } from "~/routes/activities"

interface ActivityTypeSelectProps {
  activityId: string
  activityName: string
  activityType?: ActivityType
}

export function ActivityTypeSelect({
  activityId,
  activityName,
  activityType,
}: ActivityTypeSelectProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const pendingType = fetcher.formData?.get("activityType")
  const value = isActivityType(pendingType) ? pendingType : activityType

  function handleChange(nextType: ActivityType | null) {
    if (!nextType || nextType === value) return
    const formData = new FormData()
    formData.set("intent", "update-activity-type")
    formData.set("activityId", activityId)
    formData.set("activityType", nextType)
    fetcher.submit(formData, { method: "post" })
  }

  return (
    <Select
      value={value ?? null}
      onValueChange={handleChange}
      disabled={fetcher.state !== "idle"}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Activity type for ${activityName}`}
        className="w-32 bg-muted"
      >
        <SelectValue placeholder="Choose type" />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {ACTIVITY_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {ACTIVITY_TYPE_LABELS[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
