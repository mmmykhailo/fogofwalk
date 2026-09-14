import type {
  ActivityFormat,
  ActivityStats,
  ActivityType,
  ParsedActivity,
} from "~shared/activities"
import type { GpsAnomalyResult } from "~/lib/activities/gpsAnomalies"

/**
 * Parser-only extension. The report contains no geometry and is stripped by
 * the import service before normalization, persistence, hashing, or sync.
 */
export interface GpsAnomalyReport extends Omit<GpsAnomalyResult, "paths"> {
  format: ActivityFormat
  activityType?: ActivityType
  sourcePathCount: number
  timestampPointCount: number
  nonPositiveTimestampCount: number
  emittedPathCount: number
  beforeStats: ActivityStats
  afterStats: ActivityStats | null
  detectorDurationMs: number
}

export interface ParsedImportActivity extends ParsedActivity {
  gpsAnomalyReport?: GpsAnomalyReport
}

export interface ParsedImportRejection {
  id: string
  reason: string
  /** Index of the source feature/session for diagnostic group labels. */
  activityIndex?: number
  gpsAnomalyReport?: GpsAnomalyReport
}

export interface ParsedImportParseResult {
  activities: ParsedImportActivity[]
  rejections: ParsedImportRejection[]
}

export type ActivityParserResult =
  | ParsedImportActivity[]
  | ParsedImportParseResult
