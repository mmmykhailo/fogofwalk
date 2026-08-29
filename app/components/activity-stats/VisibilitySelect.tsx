import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { cn } from "~/lib/utils"

const PRIVATE = "Private"
const PUBLIC = "Public"

interface VisibilitySelectProps {
  isPublic: boolean
  onChange: (isPublic: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  size?: "sm" | "default"
  id?: string
}

/**
 * Public / private switch used in the activity stats panel. The server is the
 * source of truth for signed-in users; local-only activities start private and stay
 * private until the user publishes them.
 */
export function VisibilitySelect({
  isPublic,
  onChange,
  disabled,
  ariaLabel = "Activity visibility",
  className,
  size = "sm",
  id,
}: VisibilitySelectProps) {
  return (
    <Select
      value={isPublic ? PUBLIC : PRIVATE}
      onValueChange={(value) => onChange(value === PUBLIC)}
      modal={false}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn("bg-muted", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value={PRIVATE}>Private</SelectItem>
        <SelectItem value={PUBLIC}>Public</SelectItem>
      </SelectContent>
    </Select>
  )
}
