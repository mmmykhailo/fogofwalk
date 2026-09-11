import type { FeatureCollection, MultiPolygon, Polygon } from "geojson"
import type { FogMode, FogWorkerActivity } from "~/types/activities"

export const FOG_PROTOCOL_VERSION = 1
// The algorithm and render representation changed from world-minus-route
// polygons to positive explored masks rendered through the fog custom layer.
// Keep these values in this protocol module so cache, worker, and coordinator
// identity checks cannot drift apart.
export const FOG_ALGORITHM_VERSION = 2
export const FOG_PARTITION_SCHEME_VERSION = 3

export type FogRequestKind = "rebuild" | "append" | "cancel"

export interface FogRequest {
  protocolVersion: typeof FOG_PROTOCOL_VERSION
  requestId: string
  generation: number
  libraryRevision: number
  /** Required for append; identifies the exact worker base being extended. */
  baseLibraryRevision?: number
  mode: FogMode
  kind: FogRequestKind
  activities: FogWorkerActivity[]
}

export type FogRenderData = FeatureCollection<Polygon | MultiPolygon>

export interface FogDiagnostics {
  processed: number
  total: number
  inputPoints: number
  outputPoints: number
  featureCount: number
  vertexCount: number
  warnings: string[]
  errors: string[]
  degraded: boolean
  /** Stable aggregate counts used by the status UI and support diagnostics. */
  warningCounts?: Record<string, number>
  errorCounts?: Record<string, number>
  repairedActivityCount?: number
  rejectedActivityCount?: number
  geometryFallbackCount?: number
}

export interface FogSnapshot {
  generation: number
  libraryRevision: number
  mode: FogMode
  algorithmVersion: typeof FOG_ALGORITHM_VERSION
  partitionSchemeVersion: typeof FOG_PARTITION_SCHEME_VERSION
  completeness: "partial" | "complete"
  geometry: FogRenderData
  diagnostics: FogDiagnostics
}

export type FogReply =
  | {
      type: "PROGRESS"
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
      libraryRevision: number
      mode: FogMode
      processed: number
      total: number
      stage: "buffering" | "aggregating" | "complete"
    }
  | {
      type: "UPDATE"
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
      snapshot: FogSnapshot
    }
  | {
      type: "ERROR"
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
      libraryRevision: number
      mode: FogMode
      activityId?: string
      partitionId?: string
      fatal: boolean
      message: string
    }
  | {
      type: "DONE"
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
      snapshot: FogSnapshot | null
    }
  | {
      type: "CANCELLED"
      protocolVersion: typeof FOG_PROTOCOL_VERSION
      requestId: string
      generation: number
      libraryRevision: number
      mode: FogMode
    }

export function isFogRequest(value: unknown): value is FogRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Partial<FogRequest>
  const activities = request.activities
  const hasActivityShape = (
    activity: unknown
  ): activity is FogWorkerActivity => {
    if (!activity || typeof activity !== "object") return false
    const candidate = activity as Partial<FogWorkerActivity>
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.name !== "string" ||
      !Array.isArray(candidate.coordinates)
    ) {
      return false
    }
    return (
      candidate.paths === undefined ||
      (Array.isArray(candidate.paths) &&
        candidate.paths.every((path) => Array.isArray(path)))
    )
  }
  return (
    request.protocolVersion === FOG_PROTOCOL_VERSION &&
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    typeof request.generation === "number" &&
    Number.isSafeInteger(request.generation) &&
    request.generation >= 0 &&
    typeof request.libraryRevision === "number" &&
    Number.isSafeInteger(request.libraryRevision) &&
    request.libraryRevision >= 0 &&
    (request.mode === "corridor" || request.mode === "fill") &&
    (request.kind === "rebuild" ||
      request.kind === "append" ||
      request.kind === "cancel") &&
    (request.kind !== "append" ||
      (typeof request.baseLibraryRevision === "number" &&
        Number.isSafeInteger(request.baseLibraryRevision) &&
        request.baseLibraryRevision! >= 0)) &&
    Array.isArray(activities) &&
    activities.every(hasActivityShape)
  )
}
