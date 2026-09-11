import { describe, expect, test } from "bun:test"
import type { ActivityMeta, ActivityTombstone } from "~shared/api"
import type { ActivityType } from "~shared/activities"
import {
  isCursorIntentReady,
  planActivitySync,
  type LocalActivityMetadata,
  type RemoteActivityWindow,
  type SyncPlannerInput,
  type SyncPlannerState,
} from "./planner"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)

function local(
  contentHash: string | undefined,
  overrides: Partial<LocalActivityMetadata> = {}
): LocalActivityMetadata {
  return {
    id: overrides.id ?? `local-${contentHash ?? "missing"}`,
    name: overrides.name ?? "walk.gpx",
    contentHash,
    isPublic: overrides.isPublic ?? false,
    activityType: overrides.activityType,
    startSunPhase: overrides.startSunPhase,
  }
}

function remote(
  contentHash: string,
  overrides: Partial<ActivityMeta> = {}
): ActivityMeta {
  return {
    contentHash,
    name: overrides.name ?? "walk.gpx",
    isPublic: overrides.isPublic ?? false,
    format: overrides.format ?? "gpx",
    activityType: overrides.activityType,
    startSunPhase: overrides.startSunPhase,
    startedAtMs: overrides.startedAtMs ?? null,
    distanceKm: overrides.distanceKm ?? 1,
    pointCount: overrides.pointCount ?? 2,
    sizeBytes: overrides.sizeBytes ?? 100,
    updatedAt: overrides.updatedAt ?? 10,
    durationMs: overrides.durationMs ?? null,
    movingTimeMs: overrides.movingTimeMs ?? null,
    elevationGainM: overrides.elevationGainM ?? 0,
    avgMovingSpeedKmh: overrides.avgMovingSpeedKmh ?? null,
  }
}

function tombstone(contentHash: string, deletedAt: number): ActivityTombstone {
  return { contentHash, deletedAt }
}

function state(overrides: Partial<SyncPlannerState> = {}): SyncPlannerState {
  return {
    cursor: overrides.cursor ?? 0,
    serverHashes: overrides.serverHashes ?? [],
    ignoredHashes: overrides.ignoredHashes,
    appliedTombstones: overrides.appliedTombstones,
  }
}

function window(
  overrides: Partial<RemoteActivityWindow> = {}
): RemoteActivityWindow {
  return {
    since: overrides.since,
    activities: overrides.activities ?? [],
    deletions: overrides.deletions ?? [],
    cursor: overrides.cursor ?? 1,
    hasMore: overrides.hasMore ?? false,
  }
}

function plan(
  localActivities: readonly LocalActivityMetadata[],
  syncState: SyncPlannerState,
  remoteWindow: RemoteActivityWindow
) {
  const input: SyncPlannerInput = {
    localActivities,
    state: syncState,
    remote: remoteWindow,
  }
  return planActivitySync(input)
}

function advanceCursor(result: ReturnType<typeof planActivitySync>) {
  if (result.cursor.type !== "advance") {
    throw new Error(`Expected an advance cursor, got ${result.cursor.reason}`)
  }
  return result.cursor
}

describe("activity sync planner", () => {
  test.each([
    {
      name: "local-only",
      localActivities: [local(HASH_A)],
      syncState: state(),
      remoteWindow: window(),
      intentTypes: ["upload"],
      reason: "local-only",
    },
    {
      name: "remote-only",
      localActivities: [],
      syncState: state(),
      remoteWindow: window({ activities: [remote(HASH_A)] }),
      intentTypes: ["download"],
      reason: "remote-only",
    },
    {
      name: "both, identical metadata",
      localActivities: [local(HASH_A)],
      syncState: state(),
      remoteWindow: window({ activities: [remote(HASH_A)] }),
      intentTypes: ["no-op"],
      reason: "already-present",
    },
    {
      name: "empty window",
      localActivities: [],
      syncState: state(),
      remoteWindow: window(),
      intentTypes: ["no-op"],
      reason: "empty-window",
    },
  ])(
    "$name has a complete deterministic intent",
    ({ localActivities, syncState, remoteWindow, intentTypes, reason }) => {
      const result = plan(localActivities, syncState, remoteWindow)
      expect(result.intents.map((intent) => intent.type)).toEqual([
        ...intentTypes,
      ])
      expect(result.intents[0]).toMatchObject({ reason })
      expect(result.diagnostics).toEqual([])
      expect(result.cursor.type).toBe("advance")
    }
  )

  test("local-only upload does not hold a receive cursor", () => {
    const result = plan([local(HASH_A)], state(), window())

    expect(result.cursor).toMatchObject({
      type: "advance",
      from: 0,
      to: 1,
      requiresIntentIds: [],
    })
    expect(result.nextState.serverHashes).toEqual([])
  })

  test("remote-only download guards cursor advancement", () => {
    const result = plan([], state(), window({ activities: [remote(HASH_A)] }))
    const download = result.intents[0]!

    expect(download).toMatchObject({
      type: "download",
      contentHash: HASH_A,
    })
    expect(result.cursor).toMatchObject({
      type: "advance",
      requiresIntentIds: [download.intentId],
    })
    expect(isCursorIntentReady(result.cursor, [])).toBe(false)
    expect(isCursorIntentReady(result.cursor, [download.intentId])).toBe(true)
  })

  test("from-scratch metadata conflict resolves in favor of local metadata", () => {
    const result = plan(
      [local(HASH_A, { name: "local.gpx", isPublic: true })],
      state(),
      window({ activities: [remote(HASH_A, { name: "remote.gpx" })] })
    )

    expect(result.intents).toMatchObject([
      {
        type: "upload",
        reason: "local-wins-from-scratch",
        requiresCursor: true,
      },
    ])
    expect(result.conflicts).toEqual([
      {
        kind: "metadata",
        contentHash: HASH_A,
        fields: ["name", "isPublic"],
        resolution: "local-wins-from-scratch",
      },
    ])
    expect(advanceCursor(result).requiresIntentIds).toEqual([
      `upload:${HASH_A}`,
    ])
  })

  test("incremental metadata conflict resolves in favor of remote metadata", () => {
    const result = plan(
      [local(HASH_A, { name: "local.gpx" })],
      state({ cursor: 10, serverHashes: [HASH_A] }),
      window({
        since: 10,
        cursor: 11,
        activities: [remote(HASH_A, { name: "remote.gpx", updatedAt: 11 })],
      })
    )

    expect(result.intents).toMatchObject([
      {
        type: "apply-remote-metadata",
        reason: "remote-wins-incremental",
      },
    ])
    expect(result.conflicts[0]).toMatchObject({
      kind: "metadata",
      resolution: "remote-wins-incremental",
    })
    expect(advanceCursor(result).requiresIntentIds).toEqual([
      `apply-remote-metadata:${HASH_A}`,
    ])
  })

  test("derived sun phase backfills only from local to a legacy remote row", () => {
    const result = plan(
      [local(HASH_A, { startSunPhase: "daylight" })],
      state({ cursor: 10, serverHashes: [HASH_A] }),
      window({
        since: 10,
        cursor: 11,
        activities: [remote(HASH_A, { updatedAt: 11 })],
      })
    )

    expect(result.intents).toMatchObject([
      { type: "upload", reason: "backfill-sun-phase", requiresCursor: true },
    ])
    expect(result.conflicts[0]).toMatchObject({
      fields: ["startSunPhase"],
      resolution: "local-derived-sun-phase-wins",
    })

    const reverse = plan(
      [local(HASH_A)],
      state({ cursor: 10, serverHashes: [HASH_A] }),
      window({
        since: 10,
        cursor: 11,
        activities: [
          remote(HASH_A, { startSunPhase: "daylight", updatedAt: 11 }),
        ],
      })
    )
    expect(reverse.intents[0]).toMatchObject({
      type: "apply-remote-metadata",
      reason: "remote-wins-incremental",
    })
  })

  test("fresh tombstone applies once and updates tombstone memory", () => {
    const result = plan(
      [local(HASH_A)],
      state({ cursor: 10, serverHashes: [HASH_A] }),
      window({
        since: 10,
        cursor: 11,
        deletions: [tombstone(HASH_A, 11)],
      })
    )

    const intent = result.intents[0]!
    expect(intent).toMatchObject({
      type: "apply-remote-tombstone",
      contentHash: HASH_A,
      localId: "local-" + HASH_A,
      deletedAt: 11,
    })
    expect(result.nextState.serverHashes).toEqual([])
    expect(result.nextState.appliedTombstones).toEqual({ [HASH_A]: 11 })
    expect(advanceCursor(result).requiresIntentIds).toEqual([intent.intentId])

    const replay = plan(
      [],
      {
        ...result.nextState,
      },
      window({
        since: 11,
        cursor: 11,
        deletions: [tombstone(HASH_A, 11)],
      })
    )
    expect(replay.intents[0]).toMatchObject({
      type: "no-op",
      reason: "replayed-tombstone",
    })
  })

  test("a re-import after an applied tombstone is resurrected, not deleted again", () => {
    const result = plan(
      [local(HASH_A, { id: "reimported" })],
      state({
        cursor: 10,
        serverHashes: [],
        appliedTombstones: { [HASH_A]: 11 },
      }),
      window({
        since: 10,
        cursor: 11,
        deletions: [tombstone(HASH_A, 11)],
      })
    )

    expect(result.intents).toMatchObject([
      { type: "upload", reason: "resurrect", requiresCursor: false },
    ])
    expect(
      result.intents.some((intent) => intent.type === "apply-remote-tombstone")
    ).toBe(false)
  })

  test("from-scratch tombstones never delete a local activity", () => {
    const result = plan(
      [local(HASH_A)],
      state(),
      window({ deletions: [tombstone(HASH_A, 11)] })
    )

    expect(result.intents[0]).toMatchObject({
      type: "upload",
      reason: "resurrect",
    })
    expect(
      result.intents.some((intent) => intent.type === "apply-remote-tombstone")
    ).toBe(false)
  })

  test("ignored hashes suppress both directions of activity transfer", () => {
    const result = plan(
      [local(HASH_A)],
      state({ ignoredHashes: [HASH_A] }),
      window({ activities: [remote(HASH_A)] })
    )

    expect(result.intents).toMatchObject([
      {
        type: "keep-local-only",
        contentHash: HASH_A,
        reason: "ignored-hash",
      },
    ])
    expect(result.intents.some((intent) => intent.type === "upload")).toBe(
      false
    )
    expect(result.intents.some((intent) => intent.type === "download")).toBe(
      false
    )
    expect(result.nextState.serverHashes).toEqual([HASH_A])
  })

  test("mixed remote work guards the cursor on every unapplied remote effect", () => {
    const result = plan(
      [local(HASH_A)],
      state({ cursor: 10, serverHashes: [HASH_A] }),
      window({
        since: 10,
        cursor: 12,
        activities: [remote(HASH_B)],
        deletions: [tombstone(HASH_A, 12)],
      })
    )

    expect(result.intents.map((intent) => intent.type)).toEqual([
      "apply-remote-tombstone",
      "download",
    ])
    expect(result.cursor).toMatchObject({
      type: "advance",
      to: 12,
      requiresIntentIds: [
        `apply-remote-tombstone:${HASH_A}`,
        `download:${HASH_B}`,
      ],
    })
  })

  test("non-advancing and decreasing windows hold the durable cursor", () => {
    const nonAdvancing = plan(
      [],
      state({ cursor: 10 }),
      window({ since: 10, cursor: 10, hasMore: true })
    )
    expect(nonAdvancing.cursor).toMatchObject({
      type: "hold",
      at: 10,
      reason: "non-advancing-page",
    })
    expect(nonAdvancing.diagnostics[0]?.code).toBe("non-advancing-page")

    const decreasing = plan(
      [],
      state({ cursor: 10 }),
      window({ since: 10, cursor: 9 })
    )
    expect(decreasing.cursor).toMatchObject({
      type: "hold",
      at: 10,
      reason: "decreasing-cursor",
    })
    expect(decreasing.nextState.cursor).toBe(10)
  })

  test("same-cursor final replays are safe but do not claim progress", () => {
    const result = plan(
      [],
      state({ cursor: 10 }),
      window({ since: 10, cursor: 10, hasMore: false })
    )

    expect(result.cursor).toEqual({
      type: "hold",
      at: 10,
      reason: "replayed-final-window",
    })
    expect(result.nextState.cursor).toBe(10)
  })

  test("a window based on another durable cursor is rejected without effects", () => {
    const result = plan(
      [],
      state({ cursor: 10 }),
      window({ since: 9, cursor: 11, activities: [remote(HASH_A)] })
    )

    expect(result.intents).toEqual([])
    expect(result.cursor).toMatchObject({
      type: "hold",
      reason: "stale-window",
    })
    expect(result.nextState.cursor).toBe(10)
  })

  test("array order does not affect the plan", () => {
    const first = plan(
      [local(HASH_B), local(HASH_A)],
      state({ cursor: 10, serverHashes: [] }),
      window({
        since: 10,
        cursor: 12,
        activities: [remote(HASH_B), remote(HASH_C)],
        deletions: [tombstone(HASH_A, 12)],
      })
    )
    const second = plan(
      [local(HASH_A), local(HASH_B)],
      state({ cursor: 10, serverHashes: [] }),
      window({
        since: 10,
        cursor: 12,
        activities: [remote(HASH_C), remote(HASH_B)],
        deletions: [tombstone(HASH_A, 12)],
      })
    )

    expect(second).toEqual(first)
  })

  test("local metadata remains uploadable while a receive cursor advances", () => {
    const result = plan(
      [local(HASH_A)],
      state({ cursor: 10 }),
      window({ since: 10, cursor: 11 })
    )

    expect(result.intents).toMatchObject([
      { type: "upload", contentHash: HASH_A, requiresCursor: false },
    ])
    expect(result.cursor).toMatchObject({
      type: "advance",
      requiresIntentIds: [],
    })
  })

  test("uses the stable metadata winner for equal-time duplicate remote rows", () => {
    const a = remote(HASH_A, { name: "a.gpx", updatedAt: 11 })
    const b = remote(HASH_A, { name: "b.gpx", updatedAt: 11 })
    const first = plan([], state(), window({ activities: [a, b] }))
    const second = plan([], state(), window({ activities: [b, a] }))

    expect(second).toEqual(first)
    expect(first.intents[0]).toMatchObject({
      type: "download",
      remote: { name: "b.gpx" },
    })
  })

  test("missing hashes are explicit no-ops rather than unsafe uploads", () => {
    const result = plan([local(undefined, { id: "legacy" })], state(), window())

    expect(result.intents).toEqual([
      {
        type: "no-op",
        intentId: "no-op:missing-content-hash:legacy",
        localId: "legacy",
        reason: "missing-content-hash",
      },
    ])
  })

  test("keeps activity types as shared metadata values", () => {
    const activityType: ActivityType = "cycling"
    const result = plan(
      [local(HASH_A, { activityType })],
      state(),
      window({ activities: [remote(HASH_A, { activityType })] })
    )

    expect(result.intents[0]).toMatchObject({
      type: "no-op",
      reason: "already-present",
    })
  })
})
