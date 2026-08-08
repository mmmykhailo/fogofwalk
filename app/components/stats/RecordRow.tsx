import { AppLink } from "~/components/AppLink"
import { CardDescription } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"

interface RecordRowProps {
  label: string
  trackId: string
  trackName: string
  value: React.ReactNode
  divider?: boolean
}

/** One personal record: label, a link back to the track on the map, and a value. */
export function RecordRow({
  label,
  trackId,
  trackName,
  value,
  divider = false,
}: RecordRowProps) {
  return (
    <div
      className={`flex items-start justify-between gap-3 ${
        divider ? "border-t border-border pt-3" : ""
      }`}
    >
      <div className="min-w-0">
        <CardDescription>{label}</CardDescription>
        <AppLink
          to={`/?track=${trackId}`}
          className="mt-0.5 block truncate"
          title={trackName}
        >
          {trackName}
        </AppLink>
      </div>
      <Badge variant="secondary" className="shrink-0 tabular-nums">
        {value}
      </Badge>
    </div>
  )
}
