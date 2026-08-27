import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"

const PRIVATE = "Private"
const PUBLIC = "Public"

interface VisibilitySelectProps {
  isPublic: boolean
  onChange: (isPublic: boolean) => void
  disabled?: boolean
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
}: VisibilitySelectProps) {
  return (
    <Select
      value={isPublic ? PUBLIC : PRIVATE}
      onValueChange={(value) => onChange(value === PUBLIC)}
      modal={false}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label="Activity visibility"
        className="bg-muted"
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
