import { openStorageDatabase, type SyncState } from "~/lib/storage"

const SYNC_STATE_ID = "default"

export type SyncOutboxOperation = "upload" | "delete" | "metadata"

export type SyncOutboxStatus =
  | "pending"
  | "in-flight"
  | "retryable"
  | "permanent"
  | "complete"

export interface SyncOutboxFailure {
  code: string
  message: string
  retryable: boolean
  status?: number
  retryAt?: number
  failedAt: number
}

export interface SyncOutboxItem {
  /** Stable record key. It may differ from dedupeKey after an upsert. */
  id: string
  /** Logical operation key. Enqueueing it twice updates one record. */
  dedupeKey: string
  operation: SyncOutboxOperation
  payload: unknown
  status: SyncOutboxStatus
  attempts: number
  availableAt: number
  createdAt: number
  updatedAt: number
  leaseId?: string
  leaseOwner?: string
  leaseUntil?: number
  lastFailure?: SyncOutboxFailure
}

export type SyncOutboxItemInput = Omit<
  SyncOutboxItem,
  | "id"
  | "status"
  | "attempts"
  | "availableAt"
  | "createdAt"
  | "updatedAt"
  | "leaseId"
  | "leaseOwner"
  | "leaseUntil"
  | "lastFailure"
> & {
  id?: string
  status?: SyncOutboxStatus
  attempts?: number
  availableAt?: number
  createdAt?: number
  updatedAt?: number
}

export interface ClaimOutboxOptions {
  now: number
  leaseMs: number
  limit?: number
  owner?: string
}

export interface SyncStateCommit {
  state: SyncState
  complete: readonly { id: string; leaseId: string }[]
  enqueue?: readonly SyncOutboxItemInput[]
}

export interface SyncRepository {
  loadState(): Promise<SyncState | null>
  saveState(state: SyncState): Promise<void>
  /** Atomically persists sync state with outbox enqueue/completion effects. */
  commitStateAndOutbox(commit: SyncStateCommit): Promise<boolean>
  clearState(): Promise<void>
  enqueueOutbox(item: SyncOutboxItemInput): Promise<SyncOutboxItem>
  loadOutbox(): Promise<SyncOutboxItem[]>
  claimOutbox(options: ClaimOutboxOptions): Promise<SyncOutboxItem[]>
  completeOutbox(id: string, leaseId: string): Promise<boolean>
  failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null>
}

interface StoredSyncState extends SyncState {
  id: string
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}:${uuid ?? `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`
}

function isSyncState(value: unknown): value is SyncState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<SyncState>
  const isStringArray = (input: unknown): input is string[] =>
    Array.isArray(input) && input.every((entry) => typeof entry === "string")
  const isTombstoneMap = (input: unknown): input is Record<string, number> =>
    input === undefined ||
    (typeof input === "object" &&
      input !== null &&
      Object.values(input).every(
        (deletedAt) =>
          typeof deletedAt === "number" &&
          Number.isFinite(deletedAt) &&
          deletedAt >= 0
      ))

  return (
    typeof candidate.cursor === "number" &&
    Number.isFinite(candidate.cursor) &&
    candidate.cursor >= 0 &&
    typeof candidate.lastSyncAt === "number" &&
    Number.isFinite(candidate.lastSyncAt) &&
    candidate.lastSyncAt >= 0 &&
    isStringArray(candidate.serverHashes) &&
    isStringArray(candidate.ignoredHashes ?? []) &&
    isTombstoneMap(candidate.appliedTombstones) &&
    (candidate.savedPointsCursor === undefined ||
      (typeof candidate.savedPointsCursor === "number" &&
        Number.isFinite(candidate.savedPointsCursor) &&
        candidate.savedPointsCursor >= 0)) &&
    isStringArray(candidate.serverSavedPointIds ?? []) &&
    isTombstoneMap(candidate.appliedSavedPointTombstones) &&
    isStringArray(candidate.outboundSavedPointIds ?? []) &&
    isStringArray(candidate.outboundSavedPointDeletionIds ?? [])
  )
}

function normaliseItem(item: SyncOutboxItemInput, now: number): SyncOutboxItem {
  const status = item.status ?? "pending"
  if (status === "in-flight") {
    throw new Error("New sync outbox items cannot start in-flight")
  }
  return {
    ...clone(item),
    id: item.id || randomId("outbox"),
    dedupeKey: item.dedupeKey,
    operation: item.operation,
    payload: clone(item.payload),
    status,
    attempts: item.attempts ?? 0,
    availableAt: item.availableAt ?? now,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  }
}

function canClaim(item: SyncOutboxItem, now: number): boolean {
  if (item.status === "pending" || item.status === "retryable") {
    return item.availableAt <= now
  }
  return item.status === "in-flight" && (item.leaseUntil ?? 0) <= now
}

function claimItem(
  item: SyncOutboxItem,
  options: ClaimOutboxOptions,
  index: number
): SyncOutboxItem {
  const leaseId = `${options.owner ?? "sync"}:${options.now}:${index}:${randomId("lease")}`
  return {
    ...item,
    status: "in-flight",
    attempts: item.attempts + 1,
    updatedAt: options.now,
    leaseId,
    leaseOwner: options.owner,
    leaseUntil: options.now + Math.max(1, options.leaseMs),
  }
}

function sameLease(item: SyncOutboxItem, leaseId: string): boolean {
  return item.status === "in-flight" && item.leaseId === leaseId
}

function orderOutbox(items: SyncOutboxItem[]): SyncOutboxItem[] {
  return items.sort(
    (a, b) =>
      a.availableAt - b.availableAt ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
  )
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("IndexedDB transaction aborted", "AbortError")
      )
  })
}

async function loadLegacySyncState(db: IDBDatabase): Promise<SyncState | null> {
  const tx = db.transaction(["sync-state", "prefs"], "readwrite")
  const dedicated = await requestResult<StoredSyncState | undefined>(
    tx.objectStore("sync-state").get(SYNC_STATE_ID)
  )
  if (dedicated) {
    await transactionResult(tx)
    const { id: _id, ...state } = dedicated
    return isSyncState(state) ? clone(state) : null
  }

  const legacy = await requestResult<
    { key: string; value: unknown } | undefined
  >(tx.objectStore("prefs").get("syncState"))
  if (!legacy || !isSyncState(legacy.value)) {
    await transactionResult(tx)
    return null
  }
  const state = clone(legacy.value)
  tx.objectStore("sync-state").put({ id: SYNC_STATE_ID, ...state })
  await transactionResult(tx)
  return state
}

export class IndexedDbSyncRepository implements SyncRepository {
  async loadState(): Promise<SyncState | null> {
    const db = await openStorageDatabase()
    if (!db) return null
    return loadLegacySyncState(db)
  }

  async saveState(state: SyncState): Promise<void> {
    await this.commitStateAndOutbox({ state, complete: [] })
  }

  async commitStateAndOutbox(commit: SyncStateCommit): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction(["sync-state", "sync-outbox"], "readwrite")
    const outboxStore = tx.objectStore("sync-outbox")
    const existing = await requestResult<SyncOutboxItem[]>(outboxStore.getAll())
    const byId = new Map(existing.map((item) => [item.id, item]))
    for (const completion of commit.complete) {
      const item = byId.get(completion.id)
      if (!item || !sameLease(item, completion.leaseId)) {
        await transactionResult(tx)
        return false
      }
    }
    const now = Date.now()
    const byDedupeKey = new Map(existing.map((item) => [item.dedupeKey, item]))
    for (const item of commit.enqueue ?? []) {
      const current = byDedupeKey.get(item.dedupeKey)
      const next = current
        ? mergeEnqueuedItem(current, item, now)
        : normaliseItem(item, now)
      byId.set(next.id, next)
      byDedupeKey.set(next.dedupeKey, next)
    }
    for (const completion of commit.complete) {
      const item = byId.get(completion.id)!
      byId.set(item.id, {
        ...item,
        status: "complete",
        updatedAt: now,
        leaseId: undefined,
        leaseOwner: undefined,
        leaseUntil: undefined,
      })
    }
    tx.objectStore("sync-state").put({
      id: SYNC_STATE_ID,
      ...clone(commit.state),
    })
    for (const item of byId.values()) outboxStore.put(item)
    await transactionResult(tx)
    return true
  }

  async clearState(): Promise<void> {
    const db = await openStorageDatabase()
    if (!db) return
    const tx = db.transaction(["sync-state", "prefs"], "readwrite")
    tx.objectStore("sync-state").delete(SYNC_STATE_ID)
    // Remove the legacy copy once the dedicated record is explicitly cleared.
    tx.objectStore("prefs").delete("syncState")
    await transactionResult(tx)
  }

  async enqueueOutbox(item: SyncOutboxItemInput): Promise<SyncOutboxItem> {
    const db = await openStorageDatabase()
    if (!db) throw new Error("IndexedDB is unavailable for sync outbox work")
    const now = item.updatedAt ?? item.createdAt ?? Date.now()
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const index = store.index("dedupeKey")
    const existing = await requestResult<SyncOutboxItem | undefined>(
      index.get(item.dedupeKey)
    )
    const next = existing
      ? mergeEnqueuedItem(existing, item, now)
      : normaliseItem(item, now)
    store.put(next)
    await transactionResult(tx)
    return clone(next)
  }

  async loadOutbox(): Promise<SyncOutboxItem[]> {
    const db = await openStorageDatabase()
    if (!db) return []
    const tx = db.transaction("sync-outbox", "readonly")
    const items = await requestResult<SyncOutboxItem[]>(
      tx.objectStore("sync-outbox").getAll()
    )
    await transactionResult(tx)
    return orderOutbox(items.map(clone))
  }

  async claimOutbox(options: ClaimOutboxOptions): Promise<SyncOutboxItem[]> {
    const db = await openStorageDatabase()
    if (!db) return []
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const items = orderOutbox(
      (await requestResult<SyncOutboxItem[]>(store.getAll())).filter((item) =>
        canClaim(item, options.now)
      )
    ).slice(0, Math.max(0, options.limit ?? 10))
    const claimed = items.map((item, index) => {
      const next = claimItem(item, options, index)
      store.put(next)
      return next
    })
    await transactionResult(tx)
    return claimed.map(clone)
  }

  async completeOutbox(id: string, leaseId: string): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const item = await requestResult<SyncOutboxItem | undefined>(store.get(id))
    if (!item || !sameLease(item, leaseId)) {
      await transactionResult(tx)
      return false
    }
    store.put({
      ...item,
      status: "complete",
      updatedAt: Date.now(),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    })
    await transactionResult(tx)
    return true
  }

  async failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null> {
    const db = await openStorageDatabase()
    if (!db) return null
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const item = await requestResult<SyncOutboxItem | undefined>(store.get(id))
    if (!item || !sameLease(item, leaseId)) {
      await transactionResult(tx)
      return null
    }
    const next: SyncOutboxItem = {
      ...item,
      status: failure.retryable ? "retryable" : "permanent",
      availableAt: failure.retryAt ?? item.availableAt,
      updatedAt: failure.failedAt,
      lastFailure: clone(failure),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    }
    store.put(next)
    await transactionResult(tx)
    return clone(next)
  }
}

function mergeEnqueuedItem(
  existing: SyncOutboxItem,
  input: SyncOutboxItemInput,
  now: number
): SyncOutboxItem {
  // Replaying an already completed operation is a no-op. Active leases are
  // also preserved so a second tab cannot replace a request another tab owns.
  if (existing.status === "complete" || existing.status === "in-flight") {
    return clone(existing)
  }
  const incoming = normaliseItem(input, now)
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    dedupeKey: existing.dedupeKey,
    attempts: existing.attempts,
    createdAt: existing.createdAt,
    status: incoming.status,
    updatedAt: now,
    lastFailure: undefined,
  }
}

export interface MemorySyncRepositoryOptions {
  now?: () => number
  idFactory?: (prefix: string) => string
}

export class MemorySyncRepository implements SyncRepository {
  private state: SyncState | null = null
  private readonly items = new Map<string, SyncOutboxItem>()
  private readonly now: () => number
  private readonly idFactory: (prefix: string) => string

  constructor(options: MemorySyncRepositoryOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? randomId
  }

  async loadState(): Promise<SyncState | null> {
    return this.state ? clone(this.state) : null
  }

  async saveState(state: SyncState): Promise<void> {
    this.state = clone(state)
  }

  async commitStateAndOutbox(commit: SyncStateCommit): Promise<boolean> {
    for (const completion of commit.complete) {
      const item = this.items.get(completion.id)
      if (!item || !sameLease(item, completion.leaseId)) return false
    }
    this.state = clone(commit.state)
    for (const input of commit.enqueue ?? []) {
      const current = [...this.items.values()].find(
        (item) => item.dedupeKey === input.dedupeKey
      )
      const now = input.updatedAt ?? input.createdAt ?? this.now()
      const next = current
        ? mergeEnqueuedItem(current, input, now)
        : normaliseItem(
            { ...input, id: input.id || this.idFactory("outbox") },
            now
          )
      this.items.set(next.id, clone(next))
    }
    for (const completion of commit.complete) {
      const item = this.items.get(completion.id)!
      this.items.set(item.id, {
        ...item,
        status: "complete",
        updatedAt: this.now(),
        leaseId: undefined,
        leaseOwner: undefined,
        leaseUntil: undefined,
      })
    }
    return true
  }

  async clearState(): Promise<void> {
    this.state = null
  }

  async enqueueOutbox(item: SyncOutboxItemInput): Promise<SyncOutboxItem> {
    const now = item.updatedAt ?? item.createdAt ?? this.now()
    const existing = [...this.items.values()].find(
      (candidate) => candidate.dedupeKey === item.dedupeKey
    )
    const next = existing
      ? mergeEnqueuedItem(existing, item, now)
      : normaliseItem({ ...item, id: item.id || this.idFactory("outbox") }, now)
    this.items.set(next.id, clone(next))
    return clone(next)
  }

  async loadOutbox(): Promise<SyncOutboxItem[]> {
    return orderOutbox([...this.items.values()].map(clone))
  }

  async claimOutbox(options: ClaimOutboxOptions): Promise<SyncOutboxItem[]> {
    const candidates = orderOutbox(
      [...this.items.values()].filter((item) => canClaim(item, options.now))
    ).slice(0, Math.max(0, options.limit ?? 10))
    const claimed = candidates.map((item, index) => {
      const next = claimItem(item, options, index)
      this.items.set(next.id, clone(next))
      return next
    })
    return claimed.map(clone)
  }

  async completeOutbox(id: string, leaseId: string): Promise<boolean> {
    const item = this.items.get(id)
    if (!item || !sameLease(item, leaseId)) return false
    this.items.set(id, {
      ...item,
      status: "complete",
      updatedAt: this.now(),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    })
    return true
  }

  async failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null> {
    const item = this.items.get(id)
    if (!item || !sameLease(item, leaseId)) return null
    const next: SyncOutboxItem = {
      ...item,
      status: failure.retryable ? "retryable" : "permanent",
      availableAt: failure.retryAt ?? item.availableAt,
      updatedAt: failure.failedAt,
      lastFailure: clone(failure),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    }
    this.items.set(id, clone(next))
    return clone(next)
  }
}
