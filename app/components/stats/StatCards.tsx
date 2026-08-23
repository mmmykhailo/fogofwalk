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

interface StatCardsProps {
  totals: LifetimeTotals
  /** Unique distance requires private track geometry, so public profiles omit it. */
  uniqueDistanceKm?: number
}

export function StatCards({ totals, uniqueDistanceKm }: StatCardsProps) {
  const avgDistanceKm =
    totals.totalTracks > 0 ? totals.totalDistanceKm / totals.totalTracks : 0
  const avgElevationM =
    totals.totalTracks > 0 ? totals.totalElevationGainM / totals.totalTracks : 0

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
            {totals.totalTracks}
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
    </div>
  )
}
