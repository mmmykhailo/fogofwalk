import type { PublicProfileStats } from "~/lib/publicProfileStats"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"

interface PublicProfileSummaryProps {
  stats: PublicProfileStats
}

function formatDate(ms: number | null): string {
  if (ms == null) return "—"
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function PublicProfileSummary({ stats }: PublicProfileSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity history</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <CardDescription className="mb-1">First activity</CardDescription>
          <p className="font-medium tabular-nums">
            {formatDate(stats.firstActivityMs)}
          </p>
        </div>
        <div>
          <CardDescription className="mb-1">Latest activity</CardDescription>
          <p className="font-medium tabular-nums">
            {formatDate(stats.latestActivityMs)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
