import { describe, expect, test } from "bun:test"
import {
  createMemorySyncRepository,
  createMemorySyncRepositoryStorage,
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
    const repository = createMemorySyncRepository()
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
    const repository = createMemorySyncRepository({ now: () => 100 })

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
    const repository = createMemorySyncRepository({ now: () => 100 })
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
    const repository = createMemorySyncRepository({ now: () => 100 })
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

  test("can claim only the effects selected by a page plan", async () => {
    const repository = createMemorySyncRepository({ now: () => 100 })
    const first = await repository.enqueueOutbox(baseItem)
    const second = await repository.enqueueOutbox({
      ...baseItem,
      id: "upload-b-1",
      dedupeKey: "upload:hash-b",
      payload: { contentHash: "b".repeat(64) },
    })

    const claimed = await repository.claimOutbox({
      now: 100,
      leaseMs: 1_000,
      ids: [second.id],
    })
    expect(claimed.map((item) => item.id)).toEqual([second.id])
    expect(
      (await repository.loadOutbox()).find((item) => item.id === first.id)
    ).toMatchObject({ status: "pending" })
  })

  test("retryable and permanent failures retain durable metadata", async () => {
    const repository = createMemorySyncRepository({ now: () => 100 })
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
    const repository = createMemorySyncRepository({ now: () => 100 })
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

  test("allows one sync leader at a time and permits expiry takeover", async () => {
    const repository = createMemorySyncRepository()

    expect(
      await repository.acquireSyncLease({
        owner: "tab-a",
        now: 100,
        leaseMs: 50,
      })
    ).toBe(true)
    expect(
      await repository.acquireSyncLease({
        owner: "tab-b",
        now: 120,
        leaseMs: 50,
      })
    ).toBe(false)
    expect(await repository.releaseSyncLease("tab-b")).toBe(false)
    expect(
      await repository.acquireSyncLease({
        owner: "tab-b",
        now: 150,
        leaseMs: 50,
      })
    ).toBe(true)
    expect(await repository.releaseSyncLease("tab-a")).toBe(false)
    expect(await repository.releaseSyncLease("tab-b")).toBe(true)
  })

  test("isolates account state and adopts legacy outbox work once", async () => {
    const storage = createMemorySyncRepositoryStorage()
    const legacy = createMemorySyncRepository({ storage, now: () => 100 })
    const accountA = createMemorySyncRepository({
      accountId: "account-a",
      storage,
      now: () => 100,
    })
    const accountB = createMemorySyncRepository({
      accountId: "account-b",
      storage,
      now: () => 100,
    })
    const legacyState: SyncState = {
      cursor: 12,
      lastSyncAt: 99,
      serverHashes: ["a".repeat(64)],
    }

    await legacy.saveState(legacyState)
    await legacy.enqueueOutbox(baseItem)

    expect(await accountA.loadOutbox()).toEqual([])
    expect(await accountA.adoptUnscopedOutbox()).toBe(1)
    expect(await accountA.loadOutbox()).toMatchObject([
      {
        id: baseItem.id,
        accountId: "account-a",
        status: "pending",
      },
    ])
    expect(await accountB.loadOutbox()).toEqual([])
    expect(await accountA.loadState()).toEqual(legacyState)
    expect(await accountB.loadState()).toBeNull()

    const [claim] = await accountA.claimOutbox({ now: 100, leaseMs: 100 })
    expect(claim).toBeDefined()
    expect(await accountB.completeOutbox(claim!.id, claim!.leaseId!)).toBe(
      false
    )
  })

  test("keeps same logical work separate when two accounts enqueue it", async () => {
    const storage = createMemorySyncRepositoryStorage()
    const accountA = createMemorySyncRepository({
      accountId: "account-a",
      storage,
    })
    const accountB = createMemorySyncRepository({
      accountId: "account-b",
      storage,
    })

    const first = await accountA.enqueueOutbox({
      ...baseItem,
      id: "account-a-item",
    })
    const second = await accountB.enqueueOutbox({
      ...baseItem,
      id: "account-b-item",
    })

    expect(second.id).not.toBe(first.id)
    expect(await accountA.loadOutbox()).toHaveLength(1)
    expect(await accountB.loadOutbox()).toHaveLength(1)
    expect((await accountA.loadOutbox())[0]?.accountId).toBe("account-a")
    expect((await accountB.loadOutbox())[0]?.accountId).toBe("account-b")
    expect((await accountA.loadOutbox())[0]?.dedupeKey).not.toBe(
      (await accountB.loadOutbox())[0]?.dedupeKey
    )
  })

  test("replaces a pending local metadata effect with its latest value", async () => {
    const repository = createMemorySyncRepository({ now: () => 10 })
    await repository.enqueueOutbox({
      dedupeKey: "activity:local-metadata:hash:visibility",
      operation: "metadata",
      payload: {
        kind: "local-metadata",
        source: "local",
        intentId: "one",
        activityId: "activity",
        contentHash: "hash",
        patch: { isPublic: true },
        libraryRevision: 1,
      },
    })
    const latest = await repository.enqueueOutbox({
      dedupeKey: "activity:local-metadata:hash:visibility",
      operation: "metadata",
      payload: {
        kind: "local-metadata",
        source: "local",
        intentId: "two",
        activityId: "activity",
        contentHash: "hash",
        patch: { isPublic: false },
        libraryRevision: 2,
      },
    })

    expect(latest.payload).toMatchObject({
      intentId: "two",
      patch: { isPublic: false },
    })
    expect(latest.status).toBe("pending")
    expect(
      (await repository.loadOutbox()).filter(
        (item) => item.operation === "metadata"
      )
    ).toHaveLength(1)
  })

  test("queues a latest local metadata value behind an in-flight request", async () => {
    const repository = createMemorySyncRepository({ now: () => 10 })
    const first = await repository.enqueueOutbox({
      dedupeKey: "activity:local-metadata:hash:visibility",
      operation: "metadata",
      payload: {
        kind: "local-metadata",
        source: "local",
        intentId: "one",
        activityId: "activity",
        contentHash: "hash",
        patch: { isPublic: true },
        libraryRevision: 1,
      },
    })
    const [claimed] = await repository.claimOutbox({
      now: 10,
      leaseMs: 1_000,
      owner: "tab-a",
    })

    const latest = await repository.enqueueOutbox({
      dedupeKey: "activity:local-metadata:hash:visibility",
      operation: "metadata",
      payload: {
        kind: "local-metadata",
        source: "local",
        intentId: "two",
        activityId: "activity",
        contentHash: "hash",
        patch: { isPublic: false },
        libraryRevision: 2,
      },
    })

    expect(latest.id).not.toBe(first.id)
    expect(latest.status).toBe("pending")
    expect(latest.payload).toMatchObject({
      intentId: "two",
      patch: { isPublic: false },
    })
    expect(await repository.loadOutbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          status: "in-flight",
          payload: expect.objectContaining({
            intentId: "one",
            patch: { isPublic: true },
          }),
        }),
        expect.objectContaining({
          id: latest.id,
          status: "pending",
          payload: expect.objectContaining({
            intentId: "two",
            patch: { isPublic: false },
          }),
        }),
      ])
    )

    expect(await repository.completeOutbox(first.id, claimed!.leaseId!)).toBe(
      true
    )
    expect(await repository.loadOutbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: "complete" }),
        expect.objectContaining({ id: latest.id, status: "pending" }),
      ])
    )
  })
})
