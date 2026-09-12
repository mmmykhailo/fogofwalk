import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogReply,
  type FogRequest,
  type FogSnapshot,
} from "./protocol"
import type { FogMode, FogWorkerActivity } from "~/types/activities"
import { validateFogRenderData } from "./engine/validate"

export interface FogCoordinatorTransport {
  send(request: FogRequest): void
}

export interface FogCoordinatorInput {
  generation: number
  libraryRevision: number
  coverageRevision: number
  mode: FogMode
  activities: readonly FogWorkerActivity[]
}

export interface FogCoordinatorScheduleOptions {
  /** Activities added since the last completed worker revision, if known. */
  appendActivities?: readonly FogWorkerActivity[]
  forceRebuild?: boolean
}

export interface FogCoordinatorRequestContext {
  request: FogRequest
  input: FogCoordinatorInput
  recovery: boolean
}

export type FogCoordinatorTerminalStatus =
  | "complete"
  | "partial"
  | "cancelled"
  | "failed"

export interface FogCoordinatorTerminal {
  context: FogCoordinatorRequestContext
  status: FogCoordinatorTerminalStatus
  snapshot: FogSnapshot | null
  error?: string
}

export interface FogCoordinatorWorkerError {
  kind: "worker" | "protocol" | "engine"
  message: string
  context?: FogCoordinatorRequestContext
}

export interface FogCoordinatorReplyResult {
  /** True when the reply belongs to the currently active request. */
  accepted: boolean
  /** True when this reply completed or cancelled the active request. */
  terminal: boolean
  /** A snapshot that passed coordinator identity checks and may be rendered. */
  snapshot: FogSnapshot | null
}

export interface FogCoordinatorEvents {
  onRequest?: (context: FogCoordinatorRequestContext) => void
  onProgress?: (
    progress: Extract<FogReply, { type: "PROGRESS" }>,
    context: FogCoordinatorRequestContext
  ) => void
  onSnapshot?: (
    snapshot: FogSnapshot,
    context: FogCoordinatorRequestContext
  ) => void
  onError?: (error: FogCoordinatorWorkerError) => void
  onTerminal?: (terminal: FogCoordinatorTerminal) => void
  onRecovery?: (context: FogCoordinatorRequestContext) => void
}

interface QueuedSnapshot {
  input: FogCoordinatorInput
  appendActivities: FogWorkerActivity[]
  forceRebuild: boolean
}

interface ActiveRequest {
  context: FogCoordinatorRequestContext
  cancel: boolean
}

interface CompletedRequest {
  input: FogCoordinatorInput
}

const MAX_RECOVERY_REBUILDS = 1

function cloneActivities(
  activities: readonly FogWorkerActivity[]
): FogWorkerActivity[] {
  return activities.map((activity) => ({
    ...activity,
    coordinates: activity.coordinates.map(([longitude, latitude]) => [
      longitude,
      latitude,
    ]),
    ...(activity.paths
      ? {
          paths: activity.paths.map((path) =>
            path.map(([longitude, latitude]) => [longitude, latitude])
          ),
        }
      : {}),
  }))
}

function sameSchedule(
  first: FogCoordinatorInput,
  second: FogCoordinatorInput
): boolean {
  return (
    first.generation === second.generation &&
    first.coverageRevision === second.coverageRevision &&
    first.mode === second.mode
  )
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `fog-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function validInput(input: FogCoordinatorInput): void {
  if (
    !validRevision(input.generation) ||
    !validRevision(input.libraryRevision) ||
    !validRevision(input.coverageRevision)
  ) {
    throw new RangeError(
      "Fog generation and library revision must be safe integers"
    )
  }
}

/**
 * Schedules revisioned fog requests without knowing how a worker is hosted.
 * A request remains the active base until its terminal reply; newer library
 * snapshots replace one coalesced queue entry and are scheduled afterward.
 */
export interface FogCoordinator {
  readonly activeRequest: FogCoordinatorRequestContext | null
  readonly queuedSnapshot: FogCoordinatorInput | null
  readonly completedSnapshot: FogCoordinatorInput | null
  schedule(
    input: FogCoordinatorInput,
    options?: FogCoordinatorScheduleOptions
  ): FogCoordinatorRequestContext | null
  cancel(): FogCoordinatorRequestContext | null
  reset(input: {
    generation: number
    libraryRevision: number
    coverageRevision: number
    mode: FogMode
  }): FogCoordinatorRequestContext
  handleWorkerFailure(reason?: unknown): void
  handleReply(reply: FogReply): FogCoordinatorReplyResult
}

export function createFogCoordinator(
  transport: FogCoordinatorTransport,
  events: FogCoordinatorEvents = {}
): FogCoordinator {
  let active: ActiveRequest | null = null
  let queued: QueuedSnapshot | null = null
  let completed: CompletedRequest | null = null
  let recoveryRebuilds = 0

  /** Queue the newest committed library snapshot and start work if idle. */
  function schedule(
    input: FogCoordinatorInput,
    options: FogCoordinatorScheduleOptions = {}
  ): FogCoordinatorRequestContext | null {
    validInput(input)
    const next: QueuedSnapshot = {
      input: {
        ...input,
        activities: cloneActivities(input.activities),
      },
      appendActivities: cloneActivities(options.appendActivities ?? []),
      forceRebuild: options.forceRebuild === true,
    }

    if (active) {
      if (
        sameSchedule(active.context.input, next.input) &&
        !next.forceRebuild &&
        next.appendActivities.length === 0
      ) {
        return null
      }
      queued = coalesce(queued, next)
      return null
    }

    if (
      completed &&
      sameSchedule(completed.input, next.input) &&
      !next.forceRebuild
    ) {
      return null
    }

    queued = next
    return startQueued()
  }

  /** Ask the worker to stop the active generation. */
  function cancel(): FogCoordinatorRequestContext | null {
    if (!active) {
      queued = null
      return null
    }

    const previous = active
    queued = null
    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: requestId(),
      generation: previous.context.request.generation,
      libraryRevision: previous.context.request.libraryRevision,
      coverageRevision: previous.context.request.coverageRevision,
      mode: previous.context.request.mode,
      kind: "cancel",
      activities: [],
    }
    const context: FogCoordinatorRequestContext = {
      request,
      input: previous.context.input,
      recovery: false,
    }
    active = { context, cancel: true }
    send(context)
    return context
  }

  /**
   * Abandon every known revision and tell the worker about a new generation.
   * The reset request is stamped with the caller's generation so a worker that
   * is still finishing an older job cannot keep publishing into the new run.
   */
  function reset(input: {
    generation: number
    libraryRevision: number
    coverageRevision: number
    mode: FogMode
  }): FogCoordinatorRequestContext {
    validInput({ ...input, activities: [] })
    const previous = active
    active = null
    queued = null
    completed = null
    recoveryRebuilds = 0
    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: requestId(),
      generation: input.generation,
      libraryRevision: input.libraryRevision,
      coverageRevision: input.coverageRevision,
      mode: input.mode,
      kind: "cancel",
      activities: [],
    }
    const context: FogCoordinatorRequestContext = {
      request,
      input: {
        ...input,
        activities: [],
      },
      recovery: false,
    }
    if (previous) {
      events.onTerminal?.({
        context: previous.context,
        status: "cancelled",
        snapshot: null,
      })
    }
    send(context)
    return context
  }

  /**
   * Mark the transport/worker unusable. One rebuild is attempted from the
   * newest known snapshot; a second failure is terminal and cannot loop.
   */
  function handleWorkerFailure(reason: unknown = "Fog worker failed"): void {
    const failed = active
    const fallback =
      queued ??
      (failed
        ? {
            input: failed.context.input,
            appendActivities: [],
            forceRebuild: true,
          }
        : completed
          ? {
              input: completed.input,
              appendActivities: [],
              forceRebuild: true,
            }
          : null)
    active = null
    queued = null
    completed = null

    const message = reason instanceof Error ? reason.message : String(reason)
    events.onError?.({
      kind: "worker",
      message: message || "Fog worker failed",
      ...(failed ? { context: failed.context } : {}),
    })
    if (failed) {
      events.onTerminal?.({
        context: failed.context,
        status: "failed",
        snapshot: null,
        error: message || "Fog worker failed",
      })
    }

    if (!fallback) return
    if (recoveryRebuilds >= MAX_RECOVERY_REBUILDS) {
      events.onError?.({
        kind: "worker",
        message: "Fog worker recovery limit reached",
      })
      return
    }

    recoveryRebuilds++
    queued = {
      input: fallback.input,
      appendActivities: [],
      forceRebuild: true,
    }
    const context = startQueued()
    if (context) events.onRecovery?.(context)
  }

  /** Handle a reply; replies for any other request/generation are ignored. */
  function handleReply(reply: FogReply): FogCoordinatorReplyResult {
    const ignored: FogCoordinatorReplyResult = {
      accepted: false,
      terminal: false,
      snapshot: null,
    }
    const current = active
    if (!current || reply.protocolVersion !== FOG_PROTOCOL_VERSION)
      return ignored
    if (
      reply.requestId !== current.context.request.requestId ||
      reply.generation !== current.context.request.generation
    ) {
      return ignored
    }

    if (reply.type === "PROGRESS") {
      if (
        reply.libraryRevision !== current.context.request.libraryRevision ||
        reply.coverageRevision !== current.context.request.coverageRevision ||
        reply.mode !== current.context.request.mode
      ) {
        return ignored
      }
      events.onProgress?.(reply, current.context)
      return { accepted: true, terminal: false, snapshot: null }
    }

    if (reply.type === "UPDATE") {
      if (!matchesSnapshot(reply.snapshot, current.context.request)) {
        return ignored
      }
      if (!hasSupersedingQueue(current.context.input)) {
        events.onSnapshot?.(reply.snapshot, current.context)
        return { accepted: true, terminal: false, snapshot: reply.snapshot }
      }
      return { accepted: true, terminal: false, snapshot: null }
    }

    if (reply.type === "ERROR") {
      events.onError?.({
        kind: reply.fatal ? "engine" : "protocol",
        message: reply.message,
        context: current.context,
      })
      return { accepted: true, terminal: false, snapshot: null }
    }

    if (reply.type === "CANCELLED") {
      if (
        reply.libraryRevision !== current.context.request.libraryRevision ||
        reply.coverageRevision !== current.context.request.coverageRevision ||
        reply.mode !== current.context.request.mode
      ) {
        return ignored
      }
      finish(current, "cancelled", null)
      return { accepted: true, terminal: true, snapshot: null }
    }

    if (
      reply.snapshot &&
      !matchesSnapshot(reply.snapshot, current.context.request)
    ) {
      return ignored
    }
    if (reply.snapshot) {
      const validation = validateFogRenderData(reply.snapshot.geometry, {
        allowInteriorRings: true,
      })
      if (!validation.ok) {
        finish(
          current,
          "failed",
          null,
          "Fog worker returned a snapshot that could not be validated"
        )
        return { accepted: true, terminal: true, snapshot: null }
      }
    }
    if (current.cancel) {
      finish(current, "cancelled", null)
      return { accepted: true, terminal: true, snapshot: null }
    }
    if (!reply.snapshot) {
      finish(current, "failed", null, "Fog worker completed without a snapshot")
      return { accepted: true, terminal: true, snapshot: null }
    }

    const snapshotIsComplete =
      reply.snapshot.completeness === "complete" &&
      !reply.snapshot.diagnostics.degraded &&
      (reply.snapshot.diagnostics.coverageReducedActivityCount ??
        reply.snapshot.diagnostics.repairedActivityCount ??
        0) === 0 &&
      (reply.snapshot.diagnostics.rejectedActivityCount ?? 0) === 0 &&
      (reply.snapshot.diagnostics.geometryFallbackCount ?? 0) === 0 &&
      reply.snapshot.diagnostics.errors.length === 0
    finish(current, snapshotIsComplete ? "complete" : "partial", reply.snapshot)
    return { accepted: true, terminal: true, snapshot: reply.snapshot }
  }

  function coalesce(
    previous: QueuedSnapshot | null,
    next: QueuedSnapshot
  ): QueuedSnapshot {
    if (!previous) return next
    if (
      previous.input.generation !== next.input.generation ||
      previous.input.mode !== next.input.mode ||
      next.input.coverageRevision <= previous.input.coverageRevision
    ) {
      return next
    }

    const byId = new Map(
      previous.appendActivities.map((activity) => [activity.id, activity])
    )
    for (const activity of next.appendActivities)
      byId.set(activity.id, activity)
    return {
      input: next.input,
      appendActivities: [...byId.values()],
      forceRebuild: previous.forceRebuild || next.forceRebuild,
    }
  }

  function startQueued(): FogCoordinatorRequestContext | null {
    const next = queued
    if (!next) return null
    queued = null

    const append =
      !next.forceRebuild &&
      next.appendActivities.length > 0 &&
      completed !== null &&
      completed.input.generation === next.input.generation &&
      completed.input.mode === next.input.mode &&
      next.input.coverageRevision > completed.input.coverageRevision

    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: requestId(),
      generation: next.input.generation,
      libraryRevision: next.input.libraryRevision,
      coverageRevision: next.input.coverageRevision,
      ...(append && completed
        ? {
            baseLibraryRevision: completed.input.libraryRevision,
            baseCoverageRevision: completed.input.coverageRevision,
          }
        : {}),
      mode: next.input.mode,
      kind: append ? "append" : "rebuild",
      activities: cloneActivities(
        append ? next.appendActivities : next.input.activities
      ),
    }
    const context: FogCoordinatorRequestContext = {
      request,
      input: next.input,
      recovery: recoveryRebuilds > 0,
    }
    active = { context, cancel: false }
    events.onRequest?.(context)
    send(context)
    return context
  }

  function send(context: FogCoordinatorRequestContext): void {
    try {
      transport.send(context.request)
    } catch (error) {
      handleWorkerFailure(error)
    }
  }

  function hasSupersedingQueue(input: FogCoordinatorInput): boolean {
    return queued !== null && !sameSchedule(queued.input, input)
  }

  function matchesSnapshot(
    snapshot: FogSnapshot,
    request: FogRequest
  ): boolean {
    return (
      snapshot.generation === request.generation &&
      snapshot.libraryRevision === request.libraryRevision &&
      snapshot.coverageRevision === request.coverageRevision &&
      snapshot.mode === request.mode &&
      snapshot.algorithmVersion === FOG_ALGORITHM_VERSION &&
      snapshot.partitionSchemeVersion === FOG_PARTITION_SCHEME_VERSION
    )
  }

  function finish(
    candidate: ActiveRequest,
    status: FogCoordinatorTerminalStatus,
    snapshot: FogSnapshot | null,
    error?: string
  ): void {
    if (active !== candidate) return
    active = null
    if (
      status === "complete" &&
      snapshot?.completeness === "complete" &&
      !snapshot.diagnostics.degraded &&
      (snapshot.diagnostics.coverageReducedActivityCount ??
        snapshot.diagnostics.repairedActivityCount ??
        0) === 0 &&
      (snapshot.diagnostics.rejectedActivityCount ?? 0) === 0 &&
      (snapshot.diagnostics.geometryFallbackCount ?? 0) === 0 &&
      snapshot.diagnostics.errors.length === 0
    ) {
      completed = { input: candidate.context.input }
      recoveryRebuilds = 0
    }
    if (
      (status === "complete" || status === "partial") &&
      snapshot &&
      !hasSupersedingQueue(candidate.context.input)
    ) {
      events.onSnapshot?.(snapshot, candidate.context)
    }
    events.onTerminal?.({
      context: candidate.context,
      status,
      snapshot,
      ...(error ? { error } : {}),
    })
    if (queued) startQueued()
  }

  return {
    get activeRequest() {
      return active?.context ?? null
    },
    get queuedSnapshot() {
      return queued?.input ?? null
    },
    get completedSnapshot() {
      return completed?.input ?? null
    },
    schedule,
    cancel,
    reset,
    handleWorkerFailure,
    handleReply,
  }
}
