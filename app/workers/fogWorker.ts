/// <reference lib="webworker" />

import type {
  FogMode,
  ParsedActivity,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "~/types/activities"
import { FOG_EMIT_INTERVAL_MS, FOG_PROGRESS_BATCH_SIZE } from "~/constants/fog"
import {
  createActivityFogBuffer,
  mergeFogMasks,
  simplifyFogForEmission,
  stripInnerRings,
  subtractFogMasks,
  worldFogFeature,
  type FogFeature,
} from "~/lib/fogGeometry"

// Corridor mode: fog maintained incrementally via difference
let fogPolygon: FogFeature = worldFogFeature()
// Corridor mode: activity buffers batched since last emit, applied once per flush
let pendingBuffers: { feature: FogFeature; file: string }[] = []
// Fill mode: cumulative union of ALL activity buffers since last RESET.
// Never cleared between emits so loops formed across any number of files are detected.
let accumulated: FogFeature | null = null

let processedCount = 0
let lastProgressCount = 0
let lastEmitTime = 0

// Generation token of the run that owns the state above. Set from every inbound
// message; a running loop bails as soon as it no longer matches.
let currentRunId = -1
// Serialises PROCESS_ACTIVITIES batches. The loop yields now, so two batches of the
// same run must not interleave over the shared accumulators above.
let jobChain: Promise<void> = Promise.resolve()

// Yields to the worker's *task* queue so pending postMessage events get
// delivered. Must be a macrotask: `await Promise.resolve()` only drains
// microtasks and would never surface a queued RESET. MessageChannel rather than
// setTimeout(0), which browsers clamp to 4ms once nested past depth 5.
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

function resetState(): void {
  fogPolygon = worldFogFeature()
  pendingBuffers = []
  accumulated = null
  processedCount = 0
  lastProgressCount = 0
  lastEmitTime = 0
}

function emitProgress(runId: number, force = false): void {
  if (processedCount === lastProgressCount) return
  if (!force && processedCount - lastProgressCount < FOG_PROGRESS_BATCH_SIZE) {
    return
  }

  self.postMessage({
    type: "PROGRESS",
    processedCount,
    runId,
  } satisfies WorkerOutboundMessage)
  lastProgressCount = processedCount
}

function flushAndEmit(mode: FogMode, runId: number) {
  if (mode === "corridor") {
    if (pendingBuffers.length > 0) {
      const batch = pendingBuffers
      pendingBuffers = []
      fogPolygon = subtractFogMasks(
        fogPolygon,
        batch.map(({ feature }) => feature),
        (index, error) => postActivityError(batch[index].file, error, runId)
      )
    }
  } else {
    // Recompute fog from the full accumulated union each time, stripping inner rings
    // at the last moment. This catches loops formed by any combination of files/batches.
    fogPolygon = accumulated
      ? subtractFogMasks(
          worldFogFeature(),
          [stripInnerRings(accumulated)],
          (_index, error) => postActivityError("fill mode", error, runId)
        )
      : worldFogFeature()
  }

  // Simplify the output before sending to reduce postMessage payload size and the
  // vertex count that MapLibre must index and render. We do NOT mutate fogPolygon
  // itself — it is used as the base polygon for the next difference() call.
  const fogToEmit = simplifyFogForEmission(fogPolygon)

  const msg: WorkerOutboundMessage = {
    type: "FOG_UPDATE",
    fogData: fogToEmit,
    processedCount,
    runId,
  }
  self.postMessage(msg)
  lastEmitTime = performance.now()
}

function postActivityError(file: string, error: unknown, runId: number): void {
  const message = error instanceof Error ? error.message : String(error)
  self.postMessage({
    type: "ERROR",
    file,
    message,
    runId,
  } satisfies WorkerOutboundMessage)
}

async function processActivities(
  activities: ParsedActivity[],
  mode: FogMode,
  runId: number
): Promise<void> {
  // Abandoned while queued behind an earlier batch.
  if (runId !== currentRunId) return
  console.debug("[worker] PROCESS_ACTIVITIES", {
    count: activities.length,
    mode,
    runId,
  })

  for (const activity of activities) {
    // Cancellation checkpoint. Yield first so any RESET the main thread posted
    // is actually dispatched, then re-read currentRunId. The loop is parked
    // exactly here whenever the message handler runs, so RESET's resetState()
    // can never land mid-activity.
    await yieldToTaskQueue()
    if (runId !== currentRunId) {
      console.debug("[worker] run abandoned", { runId, currentRunId })
      return
    }

    let activityBuffer: FogFeature | null = null
    try {
      activityBuffer = createActivityFogBuffer(activity.coordinates)
    } catch (error) {
      postActivityError(activity.name, error, runId)
    }

    if (!activityBuffer) {
      console.debug(
        "[worker] skipping activity with < 2 valid coords",
        activity.name
      )
      processedCount++
      emitProgress(runId)
      continue
    }

    if (mode === "corridor") {
      pendingBuffers.push({ feature: activityBuffer, file: activity.name })
    } else {
      // Accumulate without stripping — inner rings are preserved so the full
      // union can detect loops formed across multiple files. mergeFogMasks has
      // a non-lossy fallback: a failed union keeps both activity buffers.
      accumulated = accumulated
        ? mergeFogMasks(accumulated, activityBuffer)
        : activityBuffer
    }

    processedCount++
    emitProgress(runId)
    if (performance.now() - lastEmitTime >= FOG_EMIT_INTERVAL_MS) {
      flushAndEmit(mode, runId)
    }
  }

  if (runId !== currentRunId) return
  emitProgress(runId, true)
  flushAndEmit(mode, runId)
}

self.onmessage = (e: MessageEvent<WorkerInboundMessage>) => {
  const msg = e.data
  // Every inbound message stamps the current generation. A running loop stops
  // at its next checkpoint once this no longer matches its captured id.
  const isNewRun = msg.runId !== currentRunId
  currentRunId = msg.runId

  if (msg.type === "RESET") {
    resetState()
    self.postMessage({
      type: "FOG_UPDATE",
      fogData: worldFogFeature(),
      processedCount: 0,
      runId: msg.runId,
    } as WorkerOutboundMessage)
    return
  }

  if (msg.type === "PROCESS_ACTIVITIES") {
    // Defensive: a new generation always arrives via RESET in app code, but if
    // it ever didn't, the accumulators would still hold the abandoned run's
    // geometry and leak it into the new fog.
    if (isNewRun) resetState()
    const { activities, mode, runId } = msg
    jobChain = jobChain
      .then(async () => {
        try {
          await processActivities(activities, mode, runId)
        } catch (error) {
          if (runId === currentRunId) {
            postActivityError("fog worker", error, runId)
          }
        } finally {
          // Every accepted batch gets a matching DONE, even if an unexpected
          // geometry/runtime error escaped the per-activity recovery paths.
          if (runId === currentRunId) {
            const doneMsg: WorkerOutboundMessage = {
              type: "DONE",
              processedCount,
              runId,
            }
            console.debug("[worker] DONE", { processedCount, runId })
            self.postMessage(doneMsg)
          }
        }
      })
      .catch((err) => console.debug("[worker] job failed", err))
  }
}
