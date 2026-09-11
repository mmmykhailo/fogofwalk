import { describe, expect, test } from "bun:test"
import {
  emptySavedPointSyncState,
  migrateSavedPointSyncState,
  type SyncState,
} from "./storage"

describe("saved-point sync state", () => {
  test("migrates only legacy saved-point fields", () => {
    const legacy: SyncState = {
      cursor: 42,
      lastSyncAt: 99,
      serverHashes: ["activity-hash"],
      savedPointsCursor: 7,
      serverSavedPointIds: ["point-a"],
      appliedSavedPointTombstones: { "point-old": 6 },
      outboundSavedPointIds: ["point-b"],
      outboundSavedPointDeletionIds: ["point-c"],
    }

    expect(migrateSavedPointSyncState(legacy)).toEqual({
      cursor: 7,
      lastSyncAt: 99,
      serverPointIds: ["point-a"],
      appliedTombstones: { "point-old": 6 },
      outboundIds: ["point-b"],
      outboundDeletionIds: ["point-c"],
    })
  })

  test("does not create saved-point state from an activity-only record", () => {
    expect(
      migrateSavedPointSyncState({
        cursor: 42,
        lastSyncAt: 99,
        serverHashes: ["activity-hash"],
      })
    ).toBeNull()
  })

  test("starts with isolated empty collections", () => {
    const state = emptySavedPointSyncState()
    expect(state).toEqual({
      cursor: 0,
      lastSyncAt: 0,
      serverPointIds: [],
      appliedTombstones: {},
      outboundIds: [],
      outboundDeletionIds: [],
    })
  })
})
