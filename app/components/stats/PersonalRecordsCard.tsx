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
                trackId={records.longestActivity.track.id}
                trackName={records.longestActivity.track.name}
                value={`${records.longestActivity.distanceKm.toFixed(1)} km`}
              />
            )}
            {records.mostElevation && (
              <RecordRow
                divider
                label="Most elevation gain"
                trackId={records.mostElevation.track.id}
                trackName={records.mostElevation.track.name}
                value={formatElevation(records.mostElevation.elevationGainM)}
              />
            )}
            {records.fastestPace && (
              <RecordRow
                divider
                label="Fastest moving pace"
                trackId={records.fastestPace.track.id}
                trackName={records.fastestPace.track.name}
                value={formatPace(records.fastestPace.paceMinPerKm)}
              />
            )}
            {records.fastestAvgSpeed && (
              <RecordRow
                divider
                label="Fastest avg speed"
                trackId={records.fastestAvgSpeed.track.id}
                trackName={records.fastestAvgSpeed.track.name}
                value={`${records.fastestAvgSpeed.avgSpeedKmh.toFixed(1)} km/h`}
              />
            )}
            {records.longestMovingTime && (
              <RecordRow
                divider
                label="Longest moving time"
                trackId={records.longestMovingTime.track.id}
                trackName={records.longestMovingTime.track.name}
                value={formatMovingTime(records.longestMovingTime.movingTimeMs)}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
