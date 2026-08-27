import { AppLink } from "~/components/AppLink"
import { CardDescription } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"
import { cn } from "~/lib/utils"

interface RecordRowProps {
  label: string
  activityId: string
  activityName: string
  value: React.ReactNode
  divider?: boolean
}

/** One personal record: label, a link back to the activity on the map, and a value. */
export function RecordRow({
  label,
  activityId,
  activityName,
  value,
  divider = false,
}: RecordRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3",
        divider && "border-t border-border pt-3"
      )}
    >
      <div className="min-w-0">
        <CardDescription>{label}</CardDescription>
        <AppLink
          to={`/?activity=${activityId}`}
          className="mt-0.5 block truncate"
          title={activityName}
        >
          {activityName}
        </AppLink>
      </div>
      <Badge variant="secondary" className="shrink-0 tabular-nums">
        {value}
      </Badge>
    </div>
  )
}
