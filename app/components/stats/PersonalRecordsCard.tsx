import type { PersonalRecords } from "~/lib/statsAggregator"
import {
  formatElevation,
  formatPace,
  formatMovingTime,
} from "~/lib/statsFormatters"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { RecordRow } from "~/components/stats/RecordRow"

interface PersonalRecordsCardProps {
  records: PersonalRecords
}

export function PersonalRecordsCard({ records }: PersonalRecordsCardProps) {
  const isEmpty = !records.longestActivity

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal records</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isEmpty ? (
          <CardDescription>No data yet.</CardDescription>
        ) : (
          <>
            {records.longestActivity && (
              <RecordRow
                label="Longest activity"
                activityId={records.longestActivity.activity.id}
                activityName={records.longestActivity.activity.name}
                value={`${records.longestActivity.distanceKm.toFixed(1)} km`}
              />
            )}
            {records.mostElevation && (
              <RecordRow
                divider
                label="Most elevation gain"
                activityId={records.mostElevation.activity.id}
                activityName={records.mostElevation.activity.name}
                value={formatElevation(records.mostElevation.elevationGainM)}
              />
            )}
            {records.fastestPace && (
              <RecordRow
                divider
                label="Fastest moving pace"
                activityId={records.fastestPace.activity.id}
                activityName={records.fastestPace.activity.name}
                value={formatPace(records.fastestPace.paceMinPerKm)}
              />
            )}
            {records.fastestAvgSpeed && (
              <RecordRow
                divider
                label="Fastest avg speed"
                activityId={records.fastestAvgSpeed.activity.id}
                activityName={records.fastestAvgSpeed.activity.name}
                value={`${records.fastestAvgSpeed.avgSpeedKmh.toFixed(1)} km/h`}
              />
            )}
            {records.longestMovingTime && (
              <RecordRow
                divider
                label="Longest moving time"
                activityId={records.longestMovingTime.activity.id}
                activityName={records.longestMovingTime.activity.name}
                value={formatMovingTime(records.longestMovingTime.movingTimeMs)}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
