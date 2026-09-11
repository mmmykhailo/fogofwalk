import { describe, expect, test } from "bun:test"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogReply,
  type FogRequest,
  type FogSnapshot,
} from "./protocol"
import {
  createFogCoordinator,
  type FogCoordinatorTerminal,
} from "./coordinator"
import type { FogWorkerActivity } from "~/types/activities"

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

function input(
  generation: number,
  libraryRevision: number,
  mode: "corridor" | "fill" = "corridor",
  activities: FogWorkerActivity[] = [activity("one")]
) {
  return { generation, libraryRevision, mode, activities }
}

function snapshot(request: FogRequest): FogSnapshot {
  return {
    generation: request.generation,
    libraryRevision: request.libraryRevision,
    mode: request.mode,
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    completeness: "complete",
    geometry: { type: "FeatureCollection", features: [] },
    diagnostics: {
      processed: request.activities.length,
      total: request.activities.length,
      inputPoints: 0,
      outputPoints: 0,
      featureCount: 0,
      vertexCount: 0,
      warnings: [],
      errors: [],
      degraded: false,
    },
  }
}

function reply(
  request: FogRequest,
  overrides: Partial<FogReply> = {}
): FogReply {
  return {
    type: "DONE",
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: request.requestId,
    generation: request.generation,
    snapshot: snapshot(request),
    ...overrides,
  } as FogReply
}

function setup() {
  const requests: FogRequest[] = []
  const terminals: FogCoordinatorTerminal[] = []
  const snapshots: FogSnapshot[] = []
  const coordinator = createFogCoordinator(
    { send: (request) => requests.push(request) },
    {
      onSnapshot: (value) => snapshots.push(value),
      onTerminal: (value) => terminals.push(value),
    }
  )
  return { coordinator, requests, terminals, snapshots }
}

describe("FogCoordinator", () => {
  test("chooses rebuild first, then append from the exact completed base", () => {
    const { coordinator, requests } = setup()
    coordinator.schedule(input(4, 10), { forceRebuild: true })
    const rebuild = requests[0]!
    expect(rebuild.kind).toBe("rebuild")
    coordinator.handleReply(reply(rebuild))

    coordinator.schedule(
      input(4, 11, "corridor", [activity("one"), activity("two")]),
      {
        appendActivities: [activity("two")],
      }
    )
    const append = requests[1]!
    expect(append.kind).toBe("append")
    expect(append.baseLibraryRevision).toBe(10)
    expect(append.libraryRevision).toBe(11)
    expect(append.activities.map(({ id }) => id)).toEqual(["two"])
  })

  test("coalesces queued snapshots and drops stale replies", () => {
    const { coordinator, requests, snapshots } = setup()
    coordinator.schedule(input(1, 1), { forceRebuild: true })
    const first = requests[0]!
    coordinator.schedule(input(2, 2, "fill", [activity("two")]), {
      appendActivities: [activity("two")],
    })
    coordinator.schedule(input(3, 3, "fill", [activity("three")]), {
      appendActivities: [activity("three")],
    })

    coordinator.handleReply(reply(first))
    expect(snapshots).toHaveLength(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      kind: "rebuild",
      generation: 3,
      libraryRevision: 3,
      mode: "fill",
    })
    const latest = requests[1]!
    coordinator.handleReply({
      type: "UPDATE",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: first.requestId,
      generation: first.generation,
      snapshot: snapshot(first),
    })
    expect(snapshots).toHaveLength(0)
    coordinator.handleReply(reply(latest))
    expect(snapshots.map((value) => value.libraryRevision)).toEqual([3])
  })

  test("handles cancellation and ignores all old-generation replies", () => {
    const { coordinator, requests, terminals, snapshots } = setup()
    coordinator.schedule(input(7, 20), { forceRebuild: true })
    const old = requests[0]!
    const cancellation = coordinator.cancel()!
    expect(cancellation.request.kind).toBe("cancel")

    coordinator.handleReply(reply(old))
    expect(terminals).toHaveLength(0)
    coordinator.handleReply({
      type: "CANCELLED",
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: cancellation.request.requestId,
      generation: cancellation.request.generation,
      libraryRevision: cancellation.request.libraryRevision,
      mode: cancellation.request.mode,
    })
    expect(terminals.map(({ status }) => status)).toEqual(["cancelled"])
    expect(snapshots).toHaveLength(0)
  })

  test("resets the coordinator before a new generation starts", () => {
    const { coordinator, requests, terminals, snapshots } = setup()
    coordinator.schedule(input(2, 5), { forceRebuild: true })
    const abandoned = requests[0]!

    const reset = coordinator.reset({
      generation: 3,
      libraryRevision: 6,
      mode: "fill",
    })

    expect(reset.request).toMatchObject({
      kind: "cancel",
      generation: 3,
      libraryRevision: 6,
      mode: "fill",
    })
    expect(coordinator.activeRequest).toBeNull()
    expect(coordinator.queuedSnapshot).toBeNull()
    expect(terminals.map(({ status }) => status)).toEqual(["cancelled"])

    coordinator.handleReply(reply(abandoned))
    expect(terminals).toHaveLength(1)
    expect(snapshots).toHaveLength(0)
  })

  test("recovers once after a worker failure, then bounds repeated failures", () => {
    const { coordinator, requests, terminals } = setup()
    coordinator.schedule(input(9, 30), { forceRebuild: true })
    const first = requests[0]!
    coordinator.handleWorkerFailure(new Error("terminated"))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      kind: "rebuild",
      generation: 9,
      libraryRevision: 30,
    })
    expect(terminals[0]?.status).toBe("failed")

    coordinator.handleWorkerFailure("terminated again")
    expect(requests).toHaveLength(2)
    expect(terminals).toHaveLength(2)
    expect(terminals[1]?.status).toBe("failed")

    coordinator.handleReply(reply(first))
    expect(terminals).toHaveLength(2)
  })

  test("does not advertise a partial snapshot as an appendable base", () => {
    const { coordinator, requests, terminals, snapshots } = setup()
    coordinator.schedule(input(10, 40), { forceRebuild: true })
    const rebuild = requests[0]!
    coordinator.handleReply(
      reply(rebuild, {
        snapshot: {
          ...snapshot(rebuild),
          completeness: "partial",
          diagnostics: {
            ...snapshot(rebuild).diagnostics,
            degraded: true,
            errors: ["one: invalid geometry"],
          },
        },
      })
    )

    expect(terminals.map(({ status }) => status)).toEqual(["partial"])
    expect(snapshots).toHaveLength(1)
    expect(coordinator.completedSnapshot).toBeNull()

    coordinator.schedule(
      input(10, 41, "corridor", [activity("one"), activity("two")]),
      { appendActivities: [activity("two")] }
    )
    expect(requests[1]).toMatchObject({
      kind: "rebuild",
      libraryRevision: 41,
    })
  })
})
