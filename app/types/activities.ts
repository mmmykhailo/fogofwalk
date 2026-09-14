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
import type { FogReply, FogRequest } from "~/lib/fog/protocol"

export type FogMode = "corridor" | "fill"
export type MapMode = "flat" | "relief"

/** The only activity fields the fog worker needs to build and report geometry. */
export type FogWorkerActivity = Pick<
  ParsedActivity,
  "id" | "name" | "coordinates" | "paths"
>

/** Main-thread command shape; postToFogWorker adds protocol identity fields. */
export type FogWorkerCommand =
  | {
      type: "PROCESS_ACTIVITIES"
      activities: FogWorkerActivity[]
      mode: FogMode
      kind?: "rebuild" | "append"
      libraryRevision?: number
      coverageRevision?: number
      baseLibraryRevision?: number
      baseCoverageRevision?: number
    }
  | { type: "RESET" }

/**
 * Every worker message carries a `runId` generation token. Bumping it (via
 * `startFogRun`) abandons whatever the worker is mid-way through: the worker
 * bails out at its next checkpoint, and the main thread drops replies stamped
 * with a stale id so an abandoned run cannot repaint the fog or save its cache.
 */
export type WorkerInboundMessage = FogRequest
export type WorkerOutboundMessage = FogReply
