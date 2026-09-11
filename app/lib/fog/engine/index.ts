import type { FogWorkerActivity, FogMode } from "~/types/activities"
import { FOG_EMIT_INTERVAL_MS } from "~/constants/fog"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogDiagnostics,
  type FogRequest,
  type FogReply,
  type FogSnapshot,
} from "../protocol"
import { bufferFogActivity } from "./buffer"
import {
  appendFogMasks,
  createFogMaskAccumulator,
  finalizeFogMaskAccumulator,
  type FogMaskAccumulator,
} from "./aggregate"

export interface FogEngineHooks {
  yieldToScheduler?: () => Promise<void>
  onProgress?: (progress: Extract<FogReply, { type: "PROGRESS" }>) => void
  onUpdate?: (snapshot: FogSnapshot, request: FogRequest) => void
  onError?: (error: Extract<FogReply, { type: "ERROR" }>) => void
}

export interface FogEngineOptions {
  hooks?: FogEngineHooks
  /** Test/diagnostic override for deterministic update cadence. */
  snapshotEvery?: number
  /** Maximum time between intermediate snapshots. */
  emitIntervalMs?: number
  now?: () => number
}

export type FogEngineResult =
  | { status: "complete"; snapshot: FogSnapshot }
  | { status: "partial"; snapshot: FogSnapshot }
  | { status: "cancelled"; snapshot: null }
  | { status: "rejected"; snapshot: null; message: string }

interface EngineState {
  generation: number
  libraryRevision: number
  mode: FogMode
  accumulator: FogMaskAccumulator
  processedActivityIds: Set<string>
  diagnostics: FogDiagnostics
  completeness: "partial" | "complete"
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emptyDiagnostics(total: number): FogDiagnostics {
  return {
    processed: 0,
    total,
    inputPoints: 0,
    outputPoints: 0,
    featureCount: 0,
    vertexCount: 0,
    warnings: [],
    errors: [],
    degraded: false,
    warningCounts: {},
    errorCounts: {},
    repairedActivityCount: 0,
    rejectedActivityCount: 0,
    geometryFallbackCount: 0,
  }
}

function incrementCount(
  counts: Record<string, number> | undefined,
  key: string
): Record<string, number> {
  return {
    ...(counts ?? {}),
    [key]: (counts?.[key] ?? 0) + 1,
  }
}

function cloneDiagnostics(diagnostics: FogDiagnostics): FogDiagnostics {
  return {
    ...diagnostics,
    warnings: [...diagnostics.warnings],
    errors: [...diagnostics.errors],
    warningCounts: { ...(diagnostics.warningCounts ?? {}) },
    errorCounts: { ...(diagnostics.errorCounts ?? {}) },
  }
}

/**
 * Stateful but transport-free fog processor. The worker owns one processor;
 * tests can use the same state machine without pretending a module global is a
 * Worker. A request either extends the exact base revision or is rejected.
 */
export interface FogEngine {
  reset(generation: number, libraryRevision: number, mode: FogMode): void
  cancel(generation: number): void
  getState(): Readonly<{
    generation: number
    libraryRevision: number
    mode: FogMode
    activityCount: number
    completeness: "partial" | "complete"
  }> | null
  process(request: FogRequest): Promise<FogEngineResult>
}

export function createFogEngine(options: FogEngineOptions = {}): FogEngine {
  let state: EngineState | null = null
  const cancelledGenerations = new Set<number>()
  const hooks = options.hooks ?? {}
  const snapshotEvery =
    options.snapshotEvery == null
      ? null
      : Math.max(1, Math.floor(options.snapshotEvery))
  const emitIntervalMs = Math.max(
    50,
    Math.floor(options.emitIntervalMs ?? FOG_EMIT_INTERVAL_MS)
  )
  const now = options.now ?? (() => Date.now())

  function reset(
    generation: number,
    libraryRevision: number,
    mode: FogMode
  ): void {
    cancelledGenerations.delete(generation)
    state = {
      generation,
      libraryRevision,
      mode,
      accumulator: createFogMaskAccumulator(mode),
      processedActivityIds: new Set(),
      diagnostics: emptyDiagnostics(0),
      completeness: "complete",
    }
  }

  function cancel(generation: number): void {
    cancelledGenerations.add(generation)
  }

  function getState(): Readonly<{
    generation: number
    libraryRevision: number
    mode: FogMode
    activityCount: number
    completeness: "partial" | "complete"
  }> | null {
    if (!state) return null
    return {
      generation: state.generation,
      libraryRevision: state.libraryRevision,
      mode: state.mode,
      activityCount: state.processedActivityIds.size,
      completeness: state.completeness,
    }
  }

  function validateRequest(request: FogRequest): string | null {
    if (!Number.isSafeInteger(request.generation) || request.generation < 0) {
      return "Fog generation is invalid."
    }
    if (
      !Number.isSafeInteger(request.libraryRevision) ||
      request.libraryRevision < 0
    ) {
      return "Fog library revision is invalid."
    }
    if (request.kind === "append") {
      if (state?.generation !== request.generation) {
        return "Fog append rejected because its generation is stale."
      }
      if (state.mode !== request.mode) {
        return "Fog append rejected because its mode does not match the base."
      }
      if (request.baseLibraryRevision !== state.libraryRevision) {
        return "Fog append rejected because its base revision does not match."
      }
      if (state.completeness !== "complete") {
        return "Fog append rejected because the current base is partial; rebuild is required."
      }
      if (request.libraryRevision < state.libraryRevision) {
        return "Fog append rejected because its revision is older than the base."
      }
    }
    return null
  }

  function makeSnapshot(
    request: FogRequest,
    stage: "aggregating" | "complete"
  ): FogSnapshot {
    const currentState = state!
    const diagnostics = cloneDiagnostics(currentState.diagnostics)
    const aggregate = finalizeFogMaskAccumulator(currentState.accumulator)
    diagnostics.featureCount = aggregate.featureCount
    diagnostics.vertexCount = aggregate.vertexCount
    const warnings = [
      ...new Set([...diagnostics.warnings, ...aggregate.warnings]),
    ]
    if (aggregate.degraded) currentState.completeness = "partial"
    diagnostics.warningCounts = {
      ...(diagnostics.warningCounts ?? {}),
      ...Object.fromEntries(
        Object.entries(aggregate.warningCounts).map(([key, count]) => [
          key,
          Math.max(diagnostics.warningCounts?.[key] ?? 0, count),
        ])
      ),
    }
    diagnostics.geometryFallbackCount = Math.max(
      diagnostics.geometryFallbackCount ?? 0,
      aggregate.geometryFallbackCount
    )
    diagnostics.degraded =
      currentState.completeness === "partial" || aggregate.degraded
    return {
      generation: request.generation,
      libraryRevision: currentState.libraryRevision,
      mode: currentState.mode,
      algorithmVersion: FOG_ALGORITHM_VERSION,
      partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
      completeness:
        stage === "complete" &&
        currentState.completeness === "complete" &&
        diagnostics.errors.length === 0 &&
        !aggregate.degraded
          ? "complete"
          : "partial",
      geometry: aggregate.fogData,
      diagnostics: {
        ...diagnostics,
        warnings,
        errors: [...diagnostics.errors],
      },
    }
  }

  function emitProgress(
    request: FogRequest,
    diagnostics: FogDiagnostics,
    stage: Extract<FogReply, { type: "PROGRESS" }>["stage"]
  ): void {
    hooks.onProgress?.({
      type: "PROGRESS",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      libraryRevision: request.libraryRevision,
      mode: request.mode,
      processed: diagnostics.processed,
      total: request.activities.length,
      stage,
    })
  }

  function emitError(
    request: FogRequest,
    message: string,
    fatal: boolean,
    activityId?: string
  ): void {
    hooks.onError?.({
      type: "ERROR",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      libraryRevision: request.libraryRevision,
      mode: request.mode,
      ...(activityId ? { activityId } : {}),
      fatal,
      message,
    })
  }

  async function process(request: FogRequest): Promise<FogEngineResult> {
    const validation = validateRequest(request)
    if (validation) {
      emitError(request, validation, true)
      return { status: "rejected", snapshot: null, message: validation }
    }

    if (request.kind === "cancel") {
      cancel(request.generation)
      return { status: "cancelled", snapshot: null }
    }

    if (request.kind === "rebuild") {
      reset(request.generation, request.libraryRevision, request.mode)
    } else if (!state) {
      const message = "Fog append rejected because no worker base exists."
      emitError(request, message, true)
      return { status: "rejected", snapshot: null, message }
    } else {
      state.libraryRevision = request.libraryRevision
    }

    const currentState = state!
    const diagnostics = emptyDiagnostics(request.activities.length)
    const unseenActivityCount = request.activities.filter(
      (activity) => !currentState.processedActivityIds.has(activity.id)
    ).length
    currentState.diagnostics.total =
      request.kind === "rebuild"
        ? request.activities.length
        : Math.max(
            currentState.diagnostics.total,
            currentState.processedActivityIds.size + unseenActivityCount
          )
    let lastPublishedAt = now()
    for (let index = 0; index < request.activities.length; index += 1) {
      await (hooks.yieldToScheduler ?? (() => Promise.resolve()))()
      if (cancelledGenerations.has(request.generation)) {
        return { status: "cancelled", snapshot: null }
      }

      const activity = request.activities[index]!
      if (currentState.processedActivityIds.has(activity.id)) {
        diagnostics.processed += 1
        emitProgress(request, diagnostics, "buffering")
        continue
      }
      const result = bufferFogActivity(activity)
      diagnostics.inputPoints += result.inputPointCount
      diagnostics.outputPoints += result.outputPointCount
      currentState.processedActivityIds.add(activity.id)
      currentState.diagnostics.processed += 1
      currentState.diagnostics.inputPoints += result.inputPointCount
      currentState.diagnostics.outputPoints += result.outputPointCount
      if (result.rejected) {
        const reason = result.reason ?? "activity geometry was rejected"
        const message = `${activity.id}: ${reason}`
        diagnostics.errors.push(message)
        currentState.diagnostics.errors.push(message)
        currentState.diagnostics.errorCounts = incrementCount(
          currentState.diagnostics.errorCounts,
          `activity:${reason}`
        )
        currentState.diagnostics.rejectedActivityCount =
          (currentState.diagnostics.rejectedActivityCount ?? 0) + 1
        currentState.completeness = "partial"
        emitError(request, message, false, activity.id)
      } else {
        appendFogMasks(currentState.accumulator, result.masks)
        if (result.warnings.length > 0) {
          currentState.diagnostics.repairedActivityCount =
            (currentState.diagnostics.repairedActivityCount ?? 0) + 1
        }
        for (const warning of result.warnings) {
          const message = `${activity.id}: ${warning.message}`
          diagnostics.warnings.push(message)
          currentState.diagnostics.warnings.push(message)
          currentState.diagnostics.warningCounts = incrementCount(
            currentState.diagnostics.warningCounts,
            warning.code
          )
        }
      }
      diagnostics.processed += 1
      emitProgress(request, diagnostics, "buffering")
      const cadenceReached =
        snapshotEvery !== null && diagnostics.processed % snapshotEvery === 0
      const timeReached = now() - lastPublishedAt >= emitIntervalMs
      if (cadenceReached || timeReached) {
        emitProgress(request, diagnostics, "aggregating")
        const snapshot = makeSnapshot(request, "aggregating")
        hooks.onUpdate?.(snapshot, request)
        lastPublishedAt = now()
      }
    }

    currentState.diagnostics.total = Math.max(
      currentState.diagnostics.total,
      currentState.processedActivityIds.size
    )
    emitProgress(request, diagnostics, "aggregating")
    const snapshot = makeSnapshot(request, "complete")
    hooks.onUpdate?.(snapshot, request)
    emitProgress(request, diagnostics, "complete")
    return snapshot.completeness === "complete"
      ? { status: "complete", snapshot }
      : { status: "partial", snapshot }
  }

  return { reset, cancel, getState, process }
}
