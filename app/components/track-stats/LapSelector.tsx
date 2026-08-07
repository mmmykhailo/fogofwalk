import type { TrackLap } from "~/types/tracks"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { formatDistance } from "./formatters"

const ALL_LAPS = "all"

interface LapSelectorProps {
  laps: TrackLap[]
  activeLapNumber: number | null
  onLapSelect: (lapNumber: number | null) => void
}

/**
 * A dropdown rather than a row of chips: an auto-lap run can have 40+ laps,
 * which no chip row fits. The popup also has room to show each lap's distance,
 * which is what makes a long list navigable.
 */
export function LapSelector({
  laps,
  activeLapNumber,
  onLapSelect,
}: LapSelectorProps) {
  return (
    // String values rather than number | null so "All" is a real value and
    // never collides with Base UI's placeholder/empty semantics.
    // modal={false} because Base UI would otherwise add its own scroll lock on
    // top of the one the vaul Drawer already applies on mobile.
    <Select
      value={activeLapNumber == null ? ALL_LAPS : String(activeLapNumber)}
      onValueChange={(value) =>
        onLapSelect(value === ALL_LAPS ? null : Number(value))
      }
      modal={false}
    >
      <SelectTrigger size="sm" aria-label="Select lap" className="bg-muted">
        {/* Explicit label: the default renders the whole item text, which here
            would drag the per-lap distance into the trigger. */}
        <SelectValue>
          {(value: string) =>
            value === ALL_LAPS ? "All laps" : `Lap ${value}`
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_LAPS}>All laps</SelectItem>
        {laps.map((lap) => (
          <SelectItem key={lap.number} value={String(lap.number)}>
            Lap {lap.number}
            <span className="text-muted-foreground">
              {formatDistance(lap.stats.distanceKm)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
