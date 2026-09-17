import {
  TRAIL_DIAGNOSTIC_OPERATION_IDS,
  TRAIL_DIAGNOSTIC_STAGE,
} from "~/constants/trails"
import { recordDiagnostic } from "~/lib/diagnostics"

export type TrailArchiveErrorClass =
  | "network"
  | "http"
  | "cors"
  | "range"
  | "decode"
  | "unknown"

const reportedErrorClasses = new Set<TrailArchiveErrorClass>()

function errorDetails(value: unknown): { message: string; status: number | null } {
  if (!value || typeof value !== "object") {
    return { message: String(value ?? ""), status: null }
  }
  const candidate = value as {
    error?: unknown
    message?: unknown
    status?: unknown
    statusCode?: unknown
  }
  if (candidate.error && candidate.error !== value) {
    return errorDetails(candidate.error)
  }
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : null
  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : String(value),
    status,
  }
}

export function classifyTrailArchiveError(
  value: unknown
): TrailArchiveErrorClass {
  const { message, status } = errorDetails(value)
  const normalized = message.toLowerCase()

  if (status !== null && (status < 200 || status >= 300)) return "http"
  if (normalized.includes("cors") || normalized.includes("cross-origin")) {
    return "cors"
  }
  if (
    normalized.includes("range") ||
    normalized.includes("content-range") ||
    normalized.includes("206")
  ) {
    return "range"
  }
  if (
    normalized.includes("pmtiles") ||
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

/** Records at most one coordinate-free diagnostic for each archive error class. */
export function recordTrailArchiveError(value: unknown): TrailArchiveErrorClass {
  const errorClass = classifyTrailArchiveError(value)
  if (reportedErrorClasses.has(errorClass)) return errorClass
  reportedErrorClasses.add(errorClass)

  recordDiagnostic({
    subsystem: "render",
    operationId: TRAIL_DIAGNOSTIC_OPERATION_IDS.archive,
    stage: TRAIL_DIAGNOSTIC_STAGE,
    result: "degraded",
    errorCode: `trail_archive_${errorClass}`,
    retryability:
      errorClass === "http" || errorClass === "decode"
        ? "permanent"
        : errorClass === "unknown"
          ? "unknown"
          : "retryable",
  })
  return errorClass
}

/** Test-only reset for the session-level bounded diagnostic gate. */
export function resetTrailArchiveDiagnostics(): void {
  reportedErrorClasses.clear()
}
