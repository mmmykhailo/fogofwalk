import {
  ORDERED_TRAIL_LAYER_IDS,
  TRAIL_DIAGNOSTIC_OPERATION_IDS,
  TRAIL_DIAGNOSTIC_STAGE,
  TRAIL_SOURCE_ID,
} from "~/constants/trails"
import {
  recordDiagnostic,
  type DiagnosticRetryability,
} from "~/lib/diagnostics"

export type TrailTileErrorClass =
  | "network"
  | "http"
  | "cors"
  | "decode"
  | "unknown"

export type TrailReconciliationTrigger =
  | "initial-load"
  | "switch-change"
  | "style-reload"
  | "webgl-context-restoration"

export interface TrailResourcePresence {
  source: boolean
  layers: boolean[]
}

export interface TrailReconciliationEvent {
  trigger: TrailReconciliationTrigger
  showTrails: boolean
  sourcesReady: boolean
  sourceBefore: boolean
  layersBefore: boolean[]
  sourceAfter: boolean
  layersAfter: boolean[]
  sequence: number
}

interface TrailMapResources {
  getSource: (id: string) => unknown
  getLayer: (id: string) => unknown
}

declare global {
  interface Window {
    /** Bounded, test-only trail reconciliation evidence. */
    __fogofwalkE2eTrailEvents?: TrailReconciliationEvent[]
    __fogofwalkE2eTrailEventSequence?: number
  }
}

export function trailResourcePresence(
  map: TrailMapResources
): TrailResourcePresence {
  return {
    source: Boolean(map.getSource(TRAIL_SOURCE_ID)),
    layers: ORDERED_TRAIL_LAYER_IDS.map((id) => Boolean(map.getLayer(id))),
  }
}

export function recordTrailReconciliation(options: {
  trigger: TrailReconciliationTrigger
  showTrails: boolean
  sourcesReady: boolean
  before: TrailResourcePresence
  after: TrailResourcePresence
}): void {
  if (import.meta.env.VITE_E2E !== "1" || typeof window === "undefined") {
    return
  }

  const sequence = (window.__fogofwalkE2eTrailEventSequence ?? 0) + 1
  window.__fogofwalkE2eTrailEventSequence = sequence
  const events = window.__fogofwalkE2eTrailEvents ?? []
  events.push({
    trigger: options.trigger,
    showTrails: options.showTrails,
    sourcesReady: options.sourcesReady,
    sourceBefore: options.before.source,
    layersBefore: [...options.before.layers],
    sourceAfter: options.after.source,
    layersAfter: [...options.after.layers],
    sequence,
  })
  if (events.length > 50) events.splice(0, events.length - 50)
  window.__fogofwalkE2eTrailEvents = events
}

const reportedErrorClasses = new Set<TrailTileErrorClass>()

function errorDetails(value: unknown): {
  message: string
  status: number | null
} {
  if (!value || typeof value !== "object") {
    return { message: String(value ?? ""), status: null }
  }
  const candidate = value as {
    error?: unknown
    message?: unknown
    status?: unknown
    statusCode?: unknown
  }
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : null
  const nested =
    candidate.error && candidate.error !== value
      ? errorDetails(candidate.error)
      : null
  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : (nested?.message ?? String(value)),
    status: status ?? nested?.status ?? null,
  }
}

export function classifyTrailTileError(value: unknown): TrailTileErrorClass {
  const { message, status } = errorDetails(value)
  const normalized = message.toLowerCase()

  if (status !== null && (status < 200 || status >= 300)) return "http"
  if (normalized.includes("cors") || normalized.includes("cross-origin")) {
    return "cors"
  }
  if (
    normalized.includes("decode") ||
    normalized.includes("protobuf") ||
    normalized.includes("vector tile")
  ) {
    return "decode"
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("failed to load") ||
    normalized.includes("offline")
  ) {
    return "network"
  }
  return "unknown"
}

function trailTileRetryability(
  value: unknown,
  errorClass: TrailTileErrorClass
): DiagnosticRetryability {
  if (errorClass === "http") {
    const { status } = errorDetails(value)
    if (
      status === 408 ||
      status === 429 ||
      (status !== null && status >= 500 && status < 600)
    ) {
      return "retryable"
    }
    return "permanent"
  }
  if (errorClass === "decode") return "permanent"
  if (errorClass === "unknown") return "unknown"
  return "retryable"
}

/** Records at most one coordinate-free diagnostic for each tile error class. */
export function recordTrailTileError(value: unknown): TrailTileErrorClass {
  const errorClass = classifyTrailTileError(value)
  if (reportedErrorClasses.has(errorClass)) return errorClass
  reportedErrorClasses.add(errorClass)

  recordDiagnostic({
    subsystem: "render",
    operationId: TRAIL_DIAGNOSTIC_OPERATION_IDS.tiles,
    stage: TRAIL_DIAGNOSTIC_STAGE,
    result: "degraded",
    errorCode: `trail_tiles_${errorClass}`,
    retryability: trailTileRetryability(value, errorClass),
  })
  return errorClass
}

/** Test-only reset for the session-level bounded diagnostic gate. */
export function resetTrailTileDiagnostics(): void {
  reportedErrorClasses.clear()
}
