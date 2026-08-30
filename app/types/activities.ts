/**
 * Activity types. The format-agnostic shapes live in `shared/activities.ts` so the
 * sync server compiles against the same declarations; they are re-exported
 * here so every `~/types/activities` import site keeps working unchanged.
 *
 * What stays in this file is client-only: fog/map modes, and the worker
 * protocol (which references the `GeoJSON` global namespace — unavailable, and
 * meaningless, on the server).
 */

export type * from "~shared/activities"
export { ACTIVITY_TYPES } from "~shared/activities"

import type { ParsedActivity } from "~shared/activities"

export type FogMode = "corridor" | "fill"
export type MapMode = "flat" | "relief"

/**
 * Every worker message carries a `runId` generation token. Bumping it (via
 * `startFogRun`) abandons whatever the worker is mid-way through: the worker
 * bails out at its next checkpoint, and the main thread drops replies stamped
 * with a stale id so an abandoned run cannot repaint the fog or save its cache.
 */
export type WorkerInboundMessage =
  | {
      type: "PROCESS_ACTIVITIES"
      activities: ParsedActivity[]
      mode: FogMode
      runId: number
    }
  | { type: "RESET"; runId: number }

export type WorkerOutboundMessage =
  | {
      type: "FOG_UPDATE"
      fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      processedCount: number
      runId: number
    }
  | { type: "PROGRESS"; processedCount: number; runId: number }
  | { type: "ERROR"; file: string; message: string; runId: number }
  | { type: "DONE"; processedCount: number; runId: number }
