import type { FogWorkerActivity, FogMode } from "~/types/activities"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogDiagnostics,
  type FogRequest,
  type FogReply,
  type FogSnapshot,
} from "../protocol"
import { bufferFogActivity, type FogMask } from "./buffer"
import { buildBoundedFog } from "./aggregate"

export interface FogEngineHooks {
  yieldToScheduler?: () => Promise<void>
  onProgress?: (progress: Extract<FogReply, { type: "PROGRESS" }>) => void
  onUpdate?: (snapshot: FogSnapshot, request: FogRequest) => void
  onError?: (error: Extract<FogReply, { type: "ERROR" }>) => void
}

export interface FogEngineOptions {
  hooks?: FogEngineHooks
  snapshotEvery?: number
}

export type FogEngineResult =
  | { status: "complete"; snapshot: FogSnapshot }
  | { status: "cancelled"; snapshot: null }
  | { status: "rejected"; snapshot: null; message: string }

interface EngineState {
  generation: number
  libraryRevision: number
  mode: FogMode
  masks: FogMask[]
  processedActivityIds: Set<string>
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
  }> | null
  process(request: FogRequest): Promise<FogEngineResult>
}

export function createFogEngine(options: FogEngineOptions = {}): FogEngine {
  let state: EngineState | null = null
  const cancelledGenerations = new Set<number>()
  const hooks = options.hooks ?? {}
  const snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 5))

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
      masks: [],
      processedActivityIds: new Set(),
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
  }> | null {
    if (!state) return null
    return {
      generation: state.generation,
      libraryRevision: state.libraryRevision,
      mode: state.mode,
      activityCount: state.processedActivityIds.size,
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
      if (request.libraryRevision < state.libraryRevision) {
        return "Fog append rejected because its revision is older than the base."
      }
    }
    return null
  }

  function makeSnapshot(
    request: FogRequest,
    diagnostics: FogDiagnostics,
    stage: "aggregating" | "complete"
  ): FogSnapshot {
    const currentState = state!
    const aggregate = buildBoundedFog(currentState.masks, currentState.mode)
    diagnostics.featureCount = aggregate.featureCount
    diagnostics.vertexCount = aggregate.vertexCount
    const warnings = [
      ...new Set([...diagnostics.warnings, ...aggregate.warnings]),
    ]
    diagnostics.degraded = diagnostics.errors.length > 0 || aggregate.degraded
    return {
      generation: request.generation,
      libraryRevision: currentState.libraryRevision,
      mode: currentState.mode,
      algorithmVersion: FOG_ALGORITHM_VERSION,
      partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
      completeness:
        stage === "complete" &&
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
      protocolVersion: 1,
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
      if (result.rejected) {
        diagnostics.errors.push(
          `${activity.id}: ${result.reason ?? "activity geometry was rejected"}`
        )
        emitError(request, diagnostics.errors.at(-1)!, false, activity.id)
      } else {
        currentState.masks.push(...result.masks)
        currentState.processedActivityIds.add(activity.id)
        diagnostics.warnings.push(
          ...result.warnings.map(
            (warning) => `${activity.id}: ${warning.message}`
          )
        )
      }
      diagnostics.processed += 1
      emitProgress(request, diagnostics, "buffering")
      if (
        diagnostics.processed % snapshotEvery === 0 ||
        diagnostics.processed === request.activities.length
      ) {
        const snapshot = makeSnapshot(request, diagnostics, "aggregating")
        hooks.onUpdate?.(snapshot, request)
      }
    }

    const snapshot = makeSnapshot(request, diagnostics, "complete")
    hooks.onUpdate?.(snapshot, request)
    emitProgress(request, diagnostics, "complete")
    return { status: "complete", snapshot }
  }

  return { reset, cancel, getState, process }
}
