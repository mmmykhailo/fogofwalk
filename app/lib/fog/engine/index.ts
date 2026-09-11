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
 * Stateful but transport-free fog processor. The worker owns one instance;
 * tests can use the same state machine without pretending a module global is a
 * Worker. A request either extends the exact base revision or is rejected.
 */
export class FogEngine {
  private state: EngineState | null = null
  private cancelledGenerations = new Set<number>()
  private readonly hooks: FogEngineHooks
  private readonly snapshotEvery: number

  constructor(options: FogEngineOptions = {}) {
    this.hooks = options.hooks ?? {}
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 5))
  }

  reset(generation: number, libraryRevision: number, mode: FogMode): void {
    this.cancelledGenerations.delete(generation)
    this.state = {
      generation,
      libraryRevision,
      mode,
      masks: [],
      processedActivityIds: new Set(),
    }
  }

  cancel(generation: number): void {
    this.cancelledGenerations.add(generation)
  }

  getState(): Readonly<{
    generation: number
    libraryRevision: number
    mode: FogMode
    activityCount: number
  }> | null {
    if (!this.state) return null
    return {
      generation: this.state.generation,
      libraryRevision: this.state.libraryRevision,
      mode: this.state.mode,
      activityCount: this.state.processedActivityIds.size,
    }
  }

  async process(request: FogRequest): Promise<FogEngineResult> {
    const validation = this.validateRequest(request)
    if (validation) {
      this.emitError(request, validation, true)
      return { status: "rejected", snapshot: null, message: validation }
    }

    if (request.kind === "cancel") {
      this.cancel(request.generation)
      return { status: "cancelled", snapshot: null }
    }

    if (request.kind === "rebuild") {
      this.reset(request.generation, request.libraryRevision, request.mode)
    } else if (!this.state) {
      const message = "Fog append rejected because no worker base exists."
      this.emitError(request, message, true)
      return { status: "rejected", snapshot: null, message }
    } else {
      this.state.libraryRevision = request.libraryRevision
    }

    const state = this.state!
    const diagnostics = emptyDiagnostics(request.activities.length)
    for (let index = 0; index < request.activities.length; index += 1) {
      await (this.hooks.yieldToScheduler ?? (() => Promise.resolve()))()
      if (this.cancelledGenerations.has(request.generation)) {
        return { status: "cancelled", snapshot: null }
      }

      const activity = request.activities[index]!
      if (state.processedActivityIds.has(activity.id)) {
        diagnostics.processed += 1
        this.emitProgress(request, diagnostics, "buffering")
        continue
      }
      const result = bufferFogActivity(activity)
      diagnostics.inputPoints += result.inputPointCount
      diagnostics.outputPoints += result.outputPointCount
      if (result.rejected) {
        diagnostics.errors.push(
          `${activity.id}: ${result.reason ?? "activity geometry was rejected"}`
        )
        this.emitError(request, diagnostics.errors.at(-1)!, false, activity.id)
      } else {
        state.masks.push(...result.masks)
        state.processedActivityIds.add(activity.id)
        diagnostics.warnings.push(
          ...result.warnings.map(
            (warning) => `${activity.id}: ${warning.message}`
          )
        )
      }
      diagnostics.processed += 1
      this.emitProgress(request, diagnostics, "buffering")
      if (
        diagnostics.processed % this.snapshotEvery === 0 ||
        diagnostics.processed === request.activities.length
      ) {
        const snapshot = this.makeSnapshot(request, diagnostics, "aggregating")
        this.hooks.onUpdate?.(snapshot, request)
      }
    }

    const snapshot = this.makeSnapshot(request, diagnostics, "complete")
    this.hooks.onUpdate?.(snapshot, request)
    this.emitProgress(request, diagnostics, "complete")
    return { status: "complete", snapshot }
  }

  private validateRequest(request: FogRequest): string | null {
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
      if (this.state?.generation !== request.generation) {
        return "Fog append rejected because its generation is stale."
      }
      if (this.state.mode !== request.mode) {
        return "Fog append rejected because its mode does not match the base."
      }
      if (request.baseLibraryRevision !== this.state.libraryRevision) {
        return "Fog append rejected because its base revision does not match."
      }
      if (request.libraryRevision < this.state.libraryRevision) {
        return "Fog append rejected because its revision is older than the base."
      }
    }
    return null
  }

  private makeSnapshot(
    request: FogRequest,
    diagnostics: FogDiagnostics,
    stage: "aggregating" | "complete"
  ): FogSnapshot {
    const state = this.state!
    const aggregate = buildBoundedFog(state.masks, state.mode)
    diagnostics.featureCount = aggregate.featureCount
    diagnostics.vertexCount = aggregate.vertexCount
    const warnings = [
      ...new Set([...diagnostics.warnings, ...aggregate.warnings]),
    ]
    diagnostics.degraded = diagnostics.errors.length > 0 || aggregate.degraded
    return {
      generation: request.generation,
      libraryRevision: state.libraryRevision,
      mode: state.mode,
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

  private emitProgress(
    request: FogRequest,
    diagnostics: FogDiagnostics,
    stage: Extract<FogReply, { type: "PROGRESS" }>["stage"]
  ): void {
    this.hooks.onProgress?.({
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

  private emitError(
    request: FogRequest,
    message: string,
    fatal: boolean,
    activityId?: string
  ): void {
    this.hooks.onError?.({
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
}
