import type { FogDiagnosticSeverity } from "./protocol"

/** Keep worker diagnostics useful without retaining one item per GPS point. */
export const MAX_FOG_DIAGNOSTIC_EXAMPLES = 8

/**
 * Input normalization is intentionally explicit. A new sanitizer code must be
 * classified here before it can influence the user-visible fog status.
 */
const INFO_CODES = new Set([
  "coalesced_duplicate_point",
  "split_antimeridian",
  "simplified_path",
])

const COVERAGE_REDUCED_CODES = new Set([
  "clamped_latitude",
  "dropped_invalid_point",
  "split_teleport",
  "dropped_path",
  "point_budget_exceeded",
  "explored-mask-union-failed",
  "validation-budget-exceeded",
  "validation_budget_exceeded",
  "feature_budget_exceeded",
  "vertex_budget_exceeded",
  "serialized_byte_budget_exceeded",
  "geometry-fallback",
  "full-fog-fallback",
])

export function fogDiagnosticSeverity(code: string): FogDiagnosticSeverity {
  if (INFO_CODES.has(code)) return "info"
  if (COVERAGE_REDUCED_CODES.has(code)) return "coverage_reduced"
  return "error"
}

export function countEntries(
  counts: Record<string, number> | undefined
): number {
  return Object.values(counts ?? {}).reduce(
    (total, count) => total + Math.max(0, Math.floor(count)),
    0
  )
}

export function incrementDiagnosticCount(
  counts: Record<string, number>,
  code: string,
  amount = 1
): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  counts[code] = (counts[code] ?? 0) + Math.floor(amount)
}

export function mergeDiagnosticCounts(
  target: Record<string, number>,
  source: Record<string, number> | undefined,
  mode: "add" | "max" = "add"
): void {
  for (const [code, count] of Object.entries(source ?? {})) {
    if (!Number.isFinite(count) || count <= 0) continue
    target[code] =
      mode === "max"
        ? Math.max(target[code] ?? 0, Math.floor(count))
        : (target[code] ?? 0) + Math.floor(count)
  }
}
