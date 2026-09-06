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

interface ActivityTypeSelectProps {
  activityType?: ActivityType
  onChange: (activityType: ActivityType | null) => void
  disabled?: boolean
  mixed?: boolean
  ariaLabel?: string
  ariaDescribedBy?: string
  className?: string
}

export function ActivityTypeSelect({
  activityType,
  onChange,
  disabled,
  mixed = false,
  ariaLabel = "Activity type",
  ariaDescribedBy,
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
        aria-describedby={ariaDescribedBy}
        className={cn("bg-muted", className)}
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
