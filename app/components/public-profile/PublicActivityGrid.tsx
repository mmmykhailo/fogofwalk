import { ActivityGrid } from "~/components/stats/ActivityGrid"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

interface PublicActivityGridProps {
  recentDays: string[]
}

export function PublicActivityGrid({ recentDays }: PublicActivityGridProps) {
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
