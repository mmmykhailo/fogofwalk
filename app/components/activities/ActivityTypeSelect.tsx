import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { ACTIVITY_TYPE_LABELS, isActivityType } from "~/lib/activityType"
import { cn } from "~/lib/utils"
import { ACTIVITY_TYPES, type ActivityType } from "~/types/activities"
import { useFetcher } from "react-router"
import type { clientAction } from "~/routes/activities"

interface ActivityTypeSelectProps {
  activityType?: ActivityType
  onChange: (activityType: ActivityType | null) => void
  disabled?: boolean
  mixed?: boolean
  ariaLabel?: string
  className?: string
}

export function ActivityTypeSelect({
  activityType,
  onChange,
  disabled,
  mixed = false,
  ariaLabel = "Activity type",
  className,
}: ActivityTypeSelectProps) {
  return (
    <Select
      value={mixed ? null : (activityType ?? null)}
      onValueChange={(value) => {
        if (isActivityType(value)) onChange(value)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn("w-32 bg-muted", className)}
      >
        <SelectValue>
          {mixed
            ? "Multiple types"
            : (selected: ActivityType | null) =>
                selected ? ACTIVITY_TYPE_LABELS[selected] : "Choose type"}
        </SelectValue>
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

interface ActivityTypeSelectForActivityProps {
  activityId: string
  activityName: string
  activityType?: ActivityType
}

export function ActivityTypeSelectForActivity({
  activityId,
  activityName,
  activityType,
}: ActivityTypeSelectForActivityProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const pendingType = fetcher.formData?.get("value")
  const value = isActivityType(pendingType) ? pendingType : activityType

  function handleChange(nextType: ActivityType | null) {
    if (!nextType || nextType === value) return
    const formData = new FormData()
    formData.set("intent", "update-activity-settings")
    formData.set("activityId", activityId)
    formData.set("setting", "activityType")
    formData.set("value", nextType)
    fetcher.submit(formData, { method: "post" })
  }

  return (
    <ActivityTypeSelect
      activityType={value}
      onChange={handleChange}
      ariaLabel={`Activity type for ${activityName}`}
      disabled={fetcher.state !== "idle"}
    />
  )
}
