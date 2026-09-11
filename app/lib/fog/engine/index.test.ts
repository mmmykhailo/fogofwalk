import { describe, expect, test } from "bun:test"
import type { FogWorkerActivity } from "~/types/activities"
import { FOG_PROTOCOL_VERSION, type FogRequest } from "../protocol"
import { FogEngine } from "."

function activity(id: string): FogWorkerActivity {
  return {
    id,
    name: id,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
  }
}

function request(overrides: Partial<FogRequest> = {}): FogRequest {
  return {
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: "request-1",
    generation: 1,
    libraryRevision: 1,
    mode: "corridor",
    kind: "rebuild",
    activities: [activity("one")],
    ...overrides,
  }
}

describe("FogEngine", () => {
  test("publishes request-relative progress and a complete revisioned snapshot", async () => {
    const progress: number[] = []
    const updates: number[] = []
    const engine = new FogEngine({
      hooks: {
        onProgress: (event) => progress.push(event.processed),
        onUpdate: (snapshot) => updates.push(snapshot.libraryRevision),
      },
      snapshotEvery: 1,
    })

    const result = await engine.process(request())

    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    expect(result.snapshot.libraryRevision).toBe(1)
    expect(result.snapshot.generation).toBe(1)
    expect(result.snapshot.completeness).toBe("complete")
    expect(progress).toEqual([1, 1])
    expect(updates).toEqual([1, 1])
  })

  test("rejects an append whose base revision or mode does not match", async () => {
    const engine = new FogEngine()
    await engine.process(request())

    const staleRevision = await engine.process(
      request({
        requestId: "stale",
        kind: "append",
        libraryRevision: 2,
        baseLibraryRevision: 0,
      })
    )
    expect(staleRevision.status).toBe("rejected")

    const staleMode = await engine.process(
      request({
        requestId: "mode",
        kind: "append",
        libraryRevision: 2,
        baseLibraryRevision: 1,
        mode: "fill",
      })
    )
    expect(staleMode.status).toBe("rejected")
  })

  test("cancellation at a scheduler checkpoint produces no snapshot", async () => {
    let release: (() => void) | undefined
    const engine = new FogEngine({
      hooks: {
        yieldToScheduler: () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      },
    })
    const pending = engine.process(request())
    engine.cancel(1)
    release?.()

    expect(await pending).toEqual({ status: "cancelled", snapshot: null })
  })
})
