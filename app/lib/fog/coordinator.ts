import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogReply,
  type FogRequest,
  type FogSnapshot,
} from "./protocol"
import type { FogMode, FogWorkerActivity } from "~/types/activities"

export interface FogCoordinatorTransport {
  send(request: FogRequest): void
}

export interface FogCoordinatorInput {
  generation: number
  libraryRevision: number
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

export type FogCoordinatorTerminalStatus = "complete" | "cancelled" | "failed"

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

export interface FogCoordinatorEvents {
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
    first.libraryRevision === second.libraryRevision &&
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
    !validRevision(input.libraryRevision)
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
export class FogCoordinator {
  private readonly transport: FogCoordinatorTransport
  private readonly events: FogCoordinatorEvents
  private active: ActiveRequest | null = null
  private queued: QueuedSnapshot | null = null
  private completed: CompletedRequest | null = null
  private recoveryRebuilds = 0

  constructor(
    transport: FogCoordinatorTransport,
    events: FogCoordinatorEvents = {}
  ) {
    this.transport = transport
    this.events = events
  }

  get activeRequest(): FogCoordinatorRequestContext | null {
    return this.active?.context ?? null
  }

  get queuedSnapshot(): FogCoordinatorInput | null {
    return this.queued?.input ?? null
  }

  get completedSnapshot(): FogCoordinatorInput | null {
    return this.completed?.input ?? null
  }

  /** Queue the newest committed library snapshot and start work if idle. */
  schedule(
    input: FogCoordinatorInput,
    options: FogCoordinatorScheduleOptions = {}
  ): FogCoordinatorRequestContext | null {
    validInput(input)
    const queued: QueuedSnapshot = {
      input: {
        ...input,
        activities: cloneActivities(input.activities),
      },
      appendActivities: cloneActivities(options.appendActivities ?? []),
      forceRebuild: options.forceRebuild === true,
    }

    if (this.active) {
      this.queued = this.coalesce(this.queued, queued)
      return null
    }

    if (
      this.completed &&
      sameSchedule(this.completed.input, queued.input) &&
      !queued.forceRebuild
    ) {
      return null
    }

    this.queued = queued
    return this.startQueued()
  }

  /** Ask the worker to stop the active generation. */
  cancel(): FogCoordinatorRequestContext | null {
    if (!this.active) {
      this.queued = null
      return null
    }

    const previous = this.active
    this.queued = null
    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: requestId(),
      generation: previous.context.request.generation,
      libraryRevision: previous.context.request.libraryRevision,
      mode: previous.context.request.mode,
      kind: "cancel",
      activities: [],
    }
    const context: FogCoordinatorRequestContext = {
      request,
      input: previous.context.input,
      recovery: false,
    }
    this.active = { context, cancel: true }
    this.send(context)
    return context
  }

  /**
   * Mark the transport/worker unusable. One rebuild is attempted from the
   * newest known snapshot; a second failure is terminal and cannot loop.
   */
  handleWorkerFailure(reason: unknown = "Fog worker failed"): void {
    const failed = this.active
    const fallback =
      this.queued ??
      (failed
        ? {
            input: failed.context.input,
            appendActivities: [],
            forceRebuild: true,
          }
        : this.completed
          ? {
              input: this.completed.input,
              appendActivities: [],
              forceRebuild: true,
            }
          : null)
    this.active = null
    this.queued = null
    this.completed = null

    const message = reason instanceof Error ? reason.message : String(reason)
    this.events.onError?.({
      kind: "worker",
      message: message || "Fog worker failed",
      ...(failed ? { context: failed.context } : {}),
    })
    if (failed) {
      this.events.onTerminal?.({
        context: failed.context,
        status: "failed",
        snapshot: null,
        error: message || "Fog worker failed",
      })
    }

    if (!fallback) return
    if (this.recoveryRebuilds >= MAX_RECOVERY_REBUILDS) {
      this.events.onError?.({
        kind: "worker",
        message: "Fog worker recovery limit reached",
      })
      return
    }

    this.recoveryRebuilds++
    this.queued = {
      input: fallback.input,
      appendActivities: [],
      forceRebuild: true,
    }
    const context = this.startQueued()
    if (context) this.events.onRecovery?.(context)
  }

  /** Handle a reply; replies for any other request/generation are ignored. */
  handleReply(reply: FogReply): void {
    const active = this.active
    if (!active || reply.protocolVersion !== FOG_PROTOCOL_VERSION) return
    if (
      reply.requestId !== active.context.request.requestId ||
      reply.generation !== active.context.request.generation
    ) {
      return
    }

    if (reply.type === "PROGRESS") {
      if (
        reply.libraryRevision !== active.context.request.libraryRevision ||
        reply.mode !== active.context.request.mode
      ) {
        return
      }
      this.events.onProgress?.(reply, active.context)
      return
    }

    if (reply.type === "UPDATE") {
      if (!this.matchesSnapshot(reply.snapshot, active.context.request)) return
      if (!this.hasSupersedingQueue(active.context.input)) {
        this.events.onSnapshot?.(reply.snapshot, active.context)
      }
      return
    }

    if (reply.type === "ERROR") {
      this.events.onError?.({
        kind: reply.fatal ? "engine" : "protocol",
        message: reply.message,
        context: active.context,
      })
      return
    }

    if (reply.type === "CANCELLED") {
      if (
        reply.libraryRevision !== active.context.request.libraryRevision ||
        reply.mode !== active.context.request.mode
      ) {
        return
      }
      this.finish(active, "cancelled", null)
      return
    }

    if (
      reply.snapshot &&
      !this.matchesSnapshot(reply.snapshot, active.context.request)
    ) {
      return
    }
    if (active.cancel) {
      this.finish(active, "cancelled", null)
      return
    }
    if (!reply.snapshot) {
      this.finish(
        active,
        "failed",
        null,
        "Fog worker completed without a snapshot"
      )
      return
    }

    this.finish(active, "complete", reply.snapshot)
  }

  private coalesce(
    previous: QueuedSnapshot | null,
    next: QueuedSnapshot
  ): QueuedSnapshot {
    if (!previous) return next
    if (
      previous.input.generation !== next.input.generation ||
      previous.input.mode !== next.input.mode ||
      next.input.libraryRevision <= previous.input.libraryRevision
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

  private startQueued(): FogCoordinatorRequestContext | null {
    const queued = this.queued
    if (!queued) return null
    this.queued = null

    const append =
      !queued.forceRebuild &&
      queued.appendActivities.length > 0 &&
      this.completed !== null &&
      this.completed.input.generation === queued.input.generation &&
      this.completed.input.mode === queued.input.mode &&
      queued.input.libraryRevision > this.completed.input.libraryRevision

    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: requestId(),
      generation: queued.input.generation,
      libraryRevision: queued.input.libraryRevision,
      ...(append && this.completed
        ? { baseLibraryRevision: this.completed.input.libraryRevision }
        : {}),
      mode: queued.input.mode,
      kind: append ? "append" : "rebuild",
      activities: cloneActivities(
        append ? queued.appendActivities : queued.input.activities
      ),
    }
    const context: FogCoordinatorRequestContext = {
      request,
      input: queued.input,
      recovery: this.recoveryRebuilds > 0,
    }
    this.active = { context, cancel: false }
    this.send(context)
    return context
  }

  private send(context: FogCoordinatorRequestContext): void {
    try {
      this.transport.send(context.request)
    } catch (error) {
      this.handleWorkerFailure(error)
    }
  }

  private hasSupersedingQueue(input: FogCoordinatorInput): boolean {
    return this.queued !== null && !sameSchedule(this.queued.input, input)
  }

  private matchesSnapshot(snapshot: FogSnapshot, request: FogRequest): boolean {
    return (
      snapshot.generation === request.generation &&
      snapshot.libraryRevision === request.libraryRevision &&
      snapshot.mode === request.mode &&
      snapshot.algorithmVersion === FOG_ALGORITHM_VERSION &&
      snapshot.partitionSchemeVersion === FOG_PARTITION_SCHEME_VERSION
    )
  }

  private finish(
    active: ActiveRequest,
    status: FogCoordinatorTerminalStatus,
    snapshot: FogSnapshot | null,
    error?: string
  ): void {
    if (this.active !== active) return
    this.active = null
    if (status === "complete" && snapshot) {
      this.completed = { input: active.context.input }
      this.recoveryRebuilds = 0
      if (!this.hasSupersedingQueue(active.context.input)) {
        this.events.onSnapshot?.(snapshot, active.context)
      }
    }
    this.events.onTerminal?.({
      context: active.context,
      status,
      snapshot,
      ...(error ? { error } : {}),
    })
    if (this.queued) this.startQueued()
  }
}
