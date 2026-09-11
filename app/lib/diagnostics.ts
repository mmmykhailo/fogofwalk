import { useSyncExternalStore } from "react"

export const DIAGNOSTICS_SCHEMA_VERSION = 3
export const MAX_DIAGNOSTIC_EVENTS = 200

export type DiagnosticSubsystem =
  | "import"
  | "fog"
  | "render"
  | "sync"
  | "storage"
  | "worker"
  | "app"

export type DiagnosticResult =
  | "started"
  | "progress"
  | "success"
  | "partial"
  | "degraded"
  | "failed"
  | "cancelled"
  | "skipped"

export type DiagnosticRetryability = "retryable" | "permanent" | "unknown"

export interface DiagnosticGeometryMetrics {
  inputPoints?: number
  outputPoints?: number
  featureCount?: number
  vertexCount?: number
  ringCount?: number
  partitionCount?: number
  byteLength?: number
}

export interface DiagnosticEvent {
  timestamp: number
  subsystem: DiagnosticSubsystem
  operationId: string
  libraryRevision: number | null
  stage: string
  durationMs: number | null
  itemCount: number | null
  pointCount: number | null
  result: DiagnosticResult
  errorCode: string | null
  retryability: DiagnosticRetryability | null
  geometry: DiagnosticGeometryMetrics | null
  warningCounts: Record<string, number>
  errorCounts: Record<string, number>
  infoCounts: Record<string, number>
  coverageReducedCounts: Record<string, number>
  normalizedActivityCount: number
  coverageReducedActivityCount: number
  repairedActivityCount: number
  rejectedActivityCount: number
  geometryFallbackCount: number
}

export interface DiagnosticEventInput {
  timestamp?: number
  subsystem: DiagnosticSubsystem
  operationId?: string | null
  libraryRevision?: number | null
  stage: string
  durationMs?: number | null
  itemCount?: number | null
  pointCount?: number | null
  result: DiagnosticResult
  errorCode?: string | null
  retryability?: DiagnosticRetryability | null
  geometry?: DiagnosticGeometryMetrics | null
  warningCounts?: Record<string, number> | null
  errorCounts?: Record<string, number> | null
  infoCounts?: Record<string, number> | null
  coverageReducedCounts?: Record<string, number> | null
  normalizedActivityCount?: number | null
  coverageReducedActivityCount?: number | null
  repairedActivityCount?: number | null
  rejectedActivityCount?: number | null
  geometryFallbackCount?: number | null
}

export interface DiagnosticExport {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION
  exportedAt: number
  events: DiagnosticEvent[]
}

const listeners = new Set<() => void>()
let events: DiagnosticEvent[] = []

const SAFE_TOKEN = /^[a-z0-9][a-z0-9._:-]{0,79}$/i

function safeToken(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback
  const token = value.trim()
  return SAFE_TOKEN.test(token) ? token : fallback
}

function safeCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(1_000_000_000, Math.max(0, Math.floor(value)))
}

function safeDuration(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(86_400_000, Math.max(0, Math.round(value)))
}

function safeCounts(
  counts: Record<string, number> | null | undefined
): Record<string, number> {
  if (!counts || typeof counts !== "object") return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(counts).slice(0, 64)) {
    if (!SAFE_TOKEN.test(key)) continue
    const count = safeCount(value)
    if (count !== null) result[key] = count
  }
  return result
}

function safeRevision(value: number | null | undefined): number | null {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

function safeGeometry(
  geometry: DiagnosticGeometryMetrics | null | undefined
): DiagnosticGeometryMetrics | null {
  if (!geometry) return null
  const result: DiagnosticGeometryMetrics = {}
  const fields: (keyof DiagnosticGeometryMetrics)[] = [
    "inputPoints",
    "outputPoints",
    "featureCount",
    "vertexCount",
    "ringCount",
    "partitionCount",
    "byteLength",
  ]
  for (const field of fields) {
    const value = safeCount(geometry[field])
    if (value !== null) result[field] = value
  }
  return Object.keys(result).length > 0 ? result : null
}

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Records aggregate operation data for local support diagnostics.
 *
 * The input is deliberately a whitelist of scalar fields. There is no escape
 * hatch for file contents, route names, coordinates, tokens, or response
 * bodies, so callers cannot accidentally put those values in the export.
 */
export function recordDiagnostic(input: DiagnosticEventInput): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp:
      typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
        ? Math.max(0, Math.floor(input.timestamp))
        : Date.now(),
    subsystem: input.subsystem,
    operationId: safeToken(input.operationId, "unknown"),
    libraryRevision: safeRevision(input.libraryRevision),
    stage: safeToken(input.stage, "unknown"),
    durationMs: safeDuration(input.durationMs),
    itemCount: safeCount(input.itemCount),
    pointCount: safeCount(input.pointCount),
    result: input.result,
    errorCode:
      input.errorCode == null ? null : safeToken(input.errorCode, "unknown"),
    retryability: input.retryability ?? null,
    geometry: safeGeometry(input.geometry),
    warningCounts: safeCounts(input.warningCounts),
    errorCounts: safeCounts(input.errorCounts),
    infoCounts: safeCounts(input.infoCounts),
    coverageReducedCounts: safeCounts(input.coverageReducedCounts),
    normalizedActivityCount: safeCount(input.normalizedActivityCount) ?? 0,
    coverageReducedActivityCount:
      safeCount(input.coverageReducedActivityCount) ?? 0,
    repairedActivityCount: safeCount(input.repairedActivityCount) ?? 0,
    rejectedActivityCount: safeCount(input.rejectedActivityCount) ?? 0,
    geometryFallbackCount: safeCount(input.geometryFallbackCount) ?? 0,
  }

  events = [...events, event].slice(-MAX_DIAGNOSTIC_EVENTS)
  notify()
  return event
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Returns a stable, read-only view until the next diagnostic is recorded. */
export function getDiagnostics(): readonly DiagnosticEvent[] {
  return events
}

export function useDiagnostics(): readonly DiagnosticEvent[] {
  return useSyncExternalStore(
    subscribeDiagnostics,
    getDiagnostics,
    getDiagnostics
  )
}

export function clearDiagnostics(): void {
  if (events.length === 0) return
  events = []
  notify()
}

export function exportDiagnostics(now = Date.now()): DiagnosticExport {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    exportedAt: Number.isFinite(now)
      ? Math.max(0, Math.floor(now))
      : Date.now(),
    events: events.map((event) => ({
      ...event,
      geometry: event.geometry ? { ...event.geometry } : null,
      warningCounts: { ...event.warningCounts },
      errorCounts: { ...event.errorCounts },
      infoCounts: { ...event.infoCounts },
      coverageReducedCounts: { ...event.coverageReducedCounts },
    })),
  }
}

export function serializeDiagnostics(now = Date.now()): string {
  return JSON.stringify(exportDiagnostics(now), null, 2)
}

/** Download the local-only support bundle. Returns false outside a browser. */
export function downloadDiagnostics(): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return false
  }
  const blob = new Blob([serializeDiagnostics()], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `fogofwalk-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
