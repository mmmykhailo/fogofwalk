import type { LifetimeTotals } from "~/lib/statsAggregator"
import {
  formatKm,
  formatElevation,
  formatMovingTime,
  formatPace,
  formatSpeed,
} from "~/lib/statsFormatters"
import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
} from "~/components/ui/card"
import { Grid } from "~/components/Grid"

interface StatCardsProps {
  totals: LifetimeTotals
  /** Unique distance requires private activity geometry, so public profiles omit it. */
  uniqueDistanceKm?: number
}

export function StatCards({ totals, uniqueDistanceKm }: StatCardsProps) {
  const avgDistanceKm =
    totals.totalActivities > 0
      ? totals.totalDistanceKm / totals.totalActivities
      : 0
  const avgElevationM =
    totals.totalActivities > 0
      ? totals.totalElevationGainM / totals.totalActivities
      : 0

  return (
    <Grid columns={{ base: 2, md: 4 }}>
      <Card>
        <CardHeader>
          <CardDescription>Distance</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatKm(totals.totalDistanceKm)}
          </CardTitle>
        </CardHeader>
      </Card>

      {uniqueDistanceKm != null && (
        <Card>
          <CardHeader>
            <CardDescription>Unique distance</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatKm(uniqueDistanceKm)}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardDescription>Moving time</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.totalMovingTimeMs > 0
              ? formatMovingTime(totals.totalMovingTimeMs)
              : "—"}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Elevation gain</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatElevation(totals.totalElevationGainM)}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Activities</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.totalActivities}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Active days</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.activeDays}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg distance</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatKm(avgDistanceKm)}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg elevation gain</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatElevation(avgElevationM)}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg speed</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.avgSpeedKmh != null ? formatSpeed(totals.avgSpeedKmh) : "—"}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg moving speed</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.avgMovingSpeedKmh != null
              ? formatSpeed(totals.avgMovingSpeedKmh)
              : "—"}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg pace</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.avgPaceMinPerKm != null
              ? formatPace(totals.avgPaceMinPerKm)
              : "—"}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Avg moving pace</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {totals.avgMovingPaceMinPerKm != null
              ? formatPace(totals.avgMovingPaceMinPerKm)
              : "—"}
          </CardTitle>
        </CardHeader>
      </Card>
    </Grid>
  )
}
