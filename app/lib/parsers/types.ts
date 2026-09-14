import type { ParsedActivity } from "~shared/activities"
import type { GpsAnomalyResult } from "~/lib/activities/gpsAnomalies"

/**
 * Parser-only extension. The report contains no geometry and is stripped by
 * the import service before normalization, persistence, hashing, or sync.
 */
export type GpsAnomalyReport = Omit<GpsAnomalyResult, "paths">

export interface ParsedImportActivity extends ParsedActivity {
  gpsAnomalyReport?: GpsAnomalyReport
}
