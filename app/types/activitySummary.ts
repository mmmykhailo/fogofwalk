import type {
  ActivityType,
  ParsedActivity,
  StartSunPhase,
} from "~/types/activities"

export interface ActivitySummary {
  id: string
  name: string
  startedAtMs: number | null
  activityType?: ActivityType
  startSunPhase?: StartSunPhase
  contentHash?: string
  isPublic?: boolean
  stats: Pick<
    ParsedActivity["stats"],
    "distanceKm" | "durationMs" | "elevationGainM" | "avgMovingSpeedKmh"
  >
}
