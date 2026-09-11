/// <reference lib="webworker" />

import {
  FOG_PROTOCOL_VERSION,
  isFogRequest,
  type FogReply,
  type FogRequest,
  type FogSnapshot,
} from "~/lib/fog/protocol"
import { createFogEngine } from "~/lib/fog/engine"

// The worker is deliberately a thin transport adapter. All mutable geometry
// state and cancellation checkpoints live in the fog engine factory, which is testable
// without constructing a Worker.

const yieldChannel = new MessageChannel()
yieldChannel.port1.start()
function yieldToTaskQueue(): Promise<void> {
  return new Promise((resolve) => {
    yieldChannel.port1.addEventListener("message", () => resolve(), {
      once: true,
    })
    yieldChannel.port2.postMessage(null)
  })
}

const engine = createFogEngine({
  hooks: {
    yieldToScheduler: yieldToTaskQueue,
    onProgress: (progress) => self.postMessage(progress satisfies FogReply),
    onUpdate: (snapshot, request) =>
      self.postMessage({
        type: "UPDATE",
        protocolVersion: FOG_PROTOCOL_VERSION,
        requestId: request.requestId,
        generation: request.generation,
        snapshot,
      } satisfies FogReply),
    onError: (error) => self.postMessage(error satisfies FogReply),
  },
})

let currentGeneration = -1
let jobChain: Promise<void> = Promise.resolve()

function postCancelled(request: FogRequest): void {
  self.postMessage({
    type: "CANCELLED",
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: request.requestId,
    generation: request.generation,
    libraryRevision: request.libraryRevision,
    mode: request.mode,
  } satisfies FogReply)
}

function postDone(request: FogRequest, snapshot: FogSnapshot | null): void {
  self.postMessage({
    type: "DONE",
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: request.requestId,
    generation: request.generation,
    snapshot,
  } satisfies FogReply)
}

function postFatal(request: FogRequest, error: unknown): void {
  self.postMessage({
    type: "ERROR",
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: request.requestId,
    generation: request.generation,
    libraryRevision: request.libraryRevision,
    mode: request.mode,
    fatal: true,
    message: error instanceof Error ? error.message : String(error),
  } satisfies FogReply)
}

function invalidRequestEnvelope(value: unknown): FogRequest {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<FogRequest>)
      : ({} as Partial<FogRequest>)
  const generation =
    typeof candidate.generation === "number" &&
    Number.isSafeInteger(candidate.generation) &&
    candidate.generation >= 0
      ? candidate.generation
      : 0
  const libraryRevision =
    typeof candidate.libraryRevision === "number" &&
    Number.isSafeInteger(candidate.libraryRevision) &&
    candidate.libraryRevision >= 0
      ? candidate.libraryRevision
      : 0
  return {
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId:
      typeof candidate.requestId === "string" && candidate.requestId.length > 0
        ? candidate.requestId
        : "invalid-request",
    generation,
    libraryRevision,
    mode: candidate.mode === "fill" ? "fill" : "corridor",
    kind: "cancel",
    activities: [],
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isFogRequest(event.data)) {
    console.warn("[fog-worker] ignored malformed request")
    const request = invalidRequestEnvelope(event.data)
    postFatal(request, new Error("Fog request is invalid."))
    postDone(request, null)
    return
  }
  const request = event.data

  if (request.kind === "cancel") {
    if (currentGeneration >= 0 && currentGeneration !== request.generation) {
      engine.cancel(currentGeneration)
    }
    engine.cancel(request.generation)
    currentGeneration = request.generation
    postCancelled(request)
    return
  }

  if (request.generation !== currentGeneration) {
    if (currentGeneration >= 0) engine.cancel(currentGeneration)
    currentGeneration = request.generation
  }

  jobChain = jobChain
    .then(async () => {
      if (request.generation !== currentGeneration) {
        postCancelled(request)
        return
      }
      try {
        const result = await engine.process(request)
        if (request.generation !== currentGeneration) {
          postCancelled(request)
          return
        }
        if (result.status === "complete") {
          postDone(request, result.snapshot)
        } else if (result.status === "cancelled") {
          postCancelled(request)
        } else {
          postDone(request, null)
        }
      } catch (error) {
        if (request.generation !== currentGeneration) {
          postCancelled(request)
          return
        }
        postFatal(request, error)
        postDone(request, null)
      }
    })
    .catch((error) => {
      // Keep the chain alive for the next request. A terminal reply was already
      // attempted by the inner handler for normal engine failures.
      console.error("[fog-worker] job chain failed", error)
    })
}
