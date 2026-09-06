import { ActivityGrid } from "~/components/stats/ActivityGrid"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

interface RecentActivityCalendarCardProps {
  recentDays: string[]
}

export function RecentActivityCalendarCard({
  recentDays,
}: RecentActivityCalendarCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityGrid recentDays={recentDays} />
      </CardContent>
    </Card>
  )
}
