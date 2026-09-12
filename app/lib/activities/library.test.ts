import { describe, expect, test } from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import { createActivityLibrary } from "./library"
import { createMemoryActivityLibraryRepository } from "./repository"

function activity(id: string): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: null,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    contentHash: `hash-${id}`,
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

class TestBroadcastChannel {
  static readonly instances = new Set<TestBroadcastChannel>()
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null

  constructor(readonly name: string) {
    TestBroadcastChannel.instances.add(this)
  }

  postMessage(data: unknown): void {
    for (const instance of TestBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name) continue
      queueMicrotask(() => instance.onmessage?.({ data } as MessageEvent))
    }
  }

  close(): void {
    TestBroadcastChannel.instances.delete(this)
    this.onmessage = null
  }
}

describe("activity library metadata broadcasts", () => {
  test("patches a hydrated peer without loading its geometry again", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window
    const originalBroadcastChannel = (
      globalThis as { BroadcastChannel?: unknown }
    ).BroadcastChannel
    ;(globalThis as { window?: unknown }).window = {}
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      TestBroadcastChannel

    try {
      const base = createMemoryActivityLibraryRepository([activity("one")])
      let fullLoads = 0
      const repository = {
        load: async () => {
          fullLoads++
          return base.load()
        },
        loadSummarySnapshot: base.loadSummarySnapshot,
        commit: base.commit,
        commitMetadata: base.commitMetadata,
      }
      const firstTab = createActivityLibrary(repository)
      const secondTab = createActivityLibrary(repository)
      await firstTab.initialize()
      await secondTab.initialize()
      const events: number[] = []
      secondTab.subscribe((snapshot, change) => {
        events.push(snapshot.revision)
        expect(change.domains).toEqual({
          membership: false,
          geometry: false,
          metadata: true,
          statistics: false,
        })
      })

      await firstTab.dispatchMetadata({
        type: "updateMetadata",
        operationId: "broadcast-name",
        patches: [{ id: "one", name: "renamed.gpx" }],
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))

      expect(secondTab.getSnapshot().activities[0]?.name).toBe("renamed.gpx")
      expect(secondTab.getSnapshot().coverageRevision).toBe(0)
      expect(events).toEqual([1])
      expect(fullLoads).toBe(2)
      firstTab.close()
      secondTab.close()
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        ;(globalThis as { window?: unknown }).window = originalWindow
      }
      if (originalBroadcastChannel === undefined) {
        delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
      } else {
        ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
          originalBroadcastChannel
      }
      TestBroadcastChannel.instances.clear()
    }
  })
})
