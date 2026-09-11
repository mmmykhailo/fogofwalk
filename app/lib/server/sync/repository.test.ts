import { describe, expect, test } from "bun:test"
import {
  MemorySyncRepository,
  type SyncOutboxItemInput,
  type SyncOutboxFailure,
} from "./repository"
import type { SyncState } from "~/lib/storage"

const baseItem: SyncOutboxItemInput = {
  id: "upload-a-1",
  dedupeKey: "upload:hash-a",
  operation: "upload",
  payload: { contentHash: "a".repeat(64) },
}

const failure = (retryable: boolean, failedAt: number): SyncOutboxFailure => ({
  code: retryable ? "network" : "too-large",
  message: retryable ? "network unavailable" : "activity is too large",
  retryable,
  failedAt,
  ...(retryable ? { retryAt: failedAt + 100 } : {}),
})

describe("MemorySyncRepository", () => {
  test("loads and saves an isolated sync state snapshot", async () => {
    const repository = new MemorySyncRepository()
    const state: SyncState = {
      cursor: 12,
      lastSyncAt: 99,
      serverHashes: ["a".repeat(64)],
      ignoredHashes: ["b".repeat(64)],
    }

    await repository.saveState(state)
    state.serverHashes.push("mutated-after-save")

    expect(await repository.loadState()).toEqual({
      cursor: 12,
      lastSyncAt: 99,
      serverHashes: ["a".repeat(64)],
      ignoredHashes: ["b".repeat(64)],
    })

    await repository.clearState()
    expect(await repository.loadState()).toBeNull()
  })

  test("enqueue is idempotent and upserts a pending item", async () => {
    const repository = new MemorySyncRepository({ now: () => 100 })

    const first = await repository.enqueueOutbox(baseItem)
    const second = await repository.enqueueOutbox({
      ...baseItem,
      id: "a-different-local-id",
      payload: { contentHash: "a".repeat(64), name: "renamed.gpx" },
    })

    expect(second.id).toBe(first.id)
    expect(second.payload).toEqual({
      contentHash: "a".repeat(64),
      name: "renamed.gpx",
    })
    expect(await repository.loadOutbox()).toHaveLength(1)
  })

  test("a completed item is not resurrected by a replayed enqueue", async () => {
    const repository = new MemorySyncRepository({ now: () => 100 })
    const item = await repository.enqueueOutbox(baseItem)
    const [claimed] = await repository.claimOutbox({
      now: 100,
      leaseMs: 1_000,
      owner: "tab-a",
    })
    expect(claimed).toBeDefined()
    await repository.completeOutbox(item.id, claimed!.leaseId!)

    const replay = await repository.enqueueOutbox({
      ...baseItem,
      payload: { contentHash: "a".repeat(64), name: "replayed.gpx" },
    })
    expect(replay.status).toBe("complete")
    expect(replay.payload).toEqual(item.payload)
  })

  test("expired leases are reclaimed after a crash", async () => {
    const repository = new MemorySyncRepository({ now: () => 100 })
    const item = await repository.enqueueOutbox(baseItem)
    const [firstLease] = await repository.claimOutbox({
      now: 100,
      leaseMs: 10,
      owner: "tab-a",
    })
    expect(firstLease!.leaseOwner).toBe("tab-a")

    const [reclaimed] = await repository.claimOutbox({
      now: 110,
      leaseMs: 20,
      owner: "tab-b",
    })
    expect(reclaimed!.id).toBe(item.id)
    expect(reclaimed!.leaseOwner).toBe("tab-b")
    expect(reclaimed!.attempts).toBe(2)
    expect(await repository.completeOutbox(item.id, firstLease!.leaseId!)).toBe(
      false
    )
    expect(await repository.completeOutbox(item.id, reclaimed!.leaseId!)).toBe(
      true
    )
  })

  test("retryable and permanent failures retain durable metadata", async () => {
    const repository = new MemorySyncRepository({ now: () => 100 })
    const item = await repository.enqueueOutbox(baseItem)
    const [claimed] = await repository.claimOutbox({
      now: 100,
      leaseMs: 10,
    })

    const retry = await repository.failOutbox(
      item.id,
      claimed!.leaseId!,
      failure(true, 105)
    )
    expect(retry).toMatchObject({
      status: "retryable",
      attempts: 1,
      availableAt: 205,
      lastFailure: { code: "network", retryable: true },
    })

    const [reclaimed] = await repository.claimOutbox({
      now: 205,
      leaseMs: 10,
    })
    const permanent = await repository.failOutbox(
      item.id,
      reclaimed!.leaseId!,
      failure(false, 210)
    )
    expect(permanent).toMatchObject({
      status: "permanent",
      attempts: 2,
      lastFailure: { code: "too-large", retryable: false },
    })
    expect(await repository.claimOutbox({ now: 10_000, leaseMs: 10 })).toEqual(
      []
    )
  })

  test("commits state and leased completion as one resumable effect", async () => {
    const repository = new MemorySyncRepository({ now: () => 100 })
    const item = await repository.enqueueOutbox(baseItem)
    const [claimed] = await repository.claimOutbox({
      now: 100,
      leaseMs: 1_000,
      owner: "tab-a",
    })

    const state: SyncState = {
      cursor: 3,
      lastSyncAt: 101,
      serverHashes: ["a".repeat(64)],
    }
    expect(
      await repository.commitStateAndOutbox({
        state,
        complete: [{ id: item.id, leaseId: claimed!.leaseId! }],
      })
    ).toBe(true)
    expect(await repository.loadState()).toEqual(state)
    expect((await repository.loadOutbox())[0]?.status).toBe("complete")

    expect(
      await repository.commitStateAndOutbox({
        state: { ...state, cursor: 4 },
        complete: [{ id: item.id, leaseId: "stale-lease" }],
      })
    ).toBe(false)
    expect((await repository.loadState())?.cursor).toBe(3)
  })
})
