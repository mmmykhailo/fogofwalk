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
  mixed?: boolean
  mixedLabel?: string
  disabledDescription?: string
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
  mixed = false,
  mixedLabel = "Mixed publicity",
  disabledDescription,
  className,
  size = "sm",
  id,
}: VisibilitySelectProps) {
  const descriptionId = id ? `${id}-description` : undefined

  return (
    <>
      <Select
        value={mixed ? null : isPublic ? PUBLIC : PRIVATE}
        onValueChange={(value) => {
          if (value === PUBLIC || value === PRIVATE) onChange(value === PUBLIC)
        }}
        modal={false}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          size={size}
          aria-label={ariaLabel}
          aria-describedby={disabledDescription ? descriptionId : undefined}
          title={disabled ? disabledDescription : undefined}
          className={cn("bg-muted", className)}
        >
          <SelectValue>{mixed ? mixedLabel : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={PRIVATE}>Private</SelectItem>
          <SelectItem value={PUBLIC}>Public</SelectItem>
        </SelectContent>
      </Select>
      {disabledDescription && (
        <span id={descriptionId} className="sr-only">
          {disabledDescription}
        </span>
      )}
    </>
  )
}
