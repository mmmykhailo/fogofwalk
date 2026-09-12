import { openStorageDatabase, type SyncState } from "~/lib/storage"

const SYNC_STATE_ID = "default"
const ACCOUNT_STATE_PREFIX = "account:"
const ACCOUNT_DEDUPE_PREFIX = "account:"

const EMPTY_SYNC_STATE: SyncState = {
  cursor: 0,
  lastSyncAt: 0,
  serverHashes: [],
}

export type SyncOutboxOperation = "upload" | "download" | "delete" | "metadata"

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
  /** Account that owns this durable effect; absent means legacy/unclaimed work. */
  accountId?: string
  /** Logical operation key. Enqueueing it twice normally updates one record. */
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
  /** Newer metadata work superseded this leased effect before it settled. */
  supersededBy?: string
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
  | "supersededBy"
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
  ids?: readonly string[]
}

export interface SyncLeaseOptions {
  now: number
  leaseMs: number
  owner: string
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
  acquireSyncLease(options: SyncLeaseOptions): Promise<boolean>
  releaseSyncLease(owner: string): Promise<boolean>
  enqueueOutbox(item: SyncOutboxItemInput): Promise<SyncOutboxItem>
  loadOutbox(): Promise<SyncOutboxItem[]>
  claimOutbox(options: ClaimOutboxOptions): Promise<SyncOutboxItem[]>
  completeOutbox(id: string, leaseId: string): Promise<boolean>
  failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null>
  /** Attach legacy unscoped work to this account before it can be processed. */
  adoptUnscopedOutbox(): Promise<number>
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

function stateId(accountId?: string): string {
  return accountId ? `${ACCOUNT_STATE_PREFIX}${accountId}` : SYNC_STATE_ID
}

function accountDedupePrefix(accountId: string): string {
  return `${ACCOUNT_DEDUPE_PREFIX}${encodeURIComponent(accountId)}:`
}

function scopedDedupeKey(dedupeKey: string, accountId?: string): string {
  if (!accountId) return dedupeKey
  const prefix = accountDedupePrefix(accountId)
  return dedupeKey.startsWith(prefix) ? dedupeKey : `${prefix}${dedupeKey}`
}

export function scopedSyncOutboxDedupeKey(
  dedupeKey: string,
  accountId?: string
): string {
  return scopedDedupeKey(dedupeKey, accountId)
}

function unscopedDedupeKey(dedupeKey: string, accountId?: string): string {
  if (!accountId) return dedupeKey
  const prefix = accountDedupePrefix(accountId)
  return dedupeKey.startsWith(prefix)
    ? dedupeKey.slice(prefix.length)
    : dedupeKey
}

function prepareOutboxInput(
  item: SyncOutboxItemInput,
  accountId?: string
): SyncOutboxItemInput {
  if (!accountId || item.accountId === accountId) return item
  if (item.accountId && item.accountId !== accountId) {
    throw new Error("A sync repository cannot enqueue another account's work")
  }
  return { ...item, accountId }
}

function belongsToScope(item: SyncOutboxItem, accountId?: string): boolean {
  return accountId === undefined || item.accountId === accountId
}

function rebindOutboxItem(
  item: SyncOutboxItem,
  accountId: string
): SyncOutboxItem {
  return {
    ...item,
    accountId,
    dedupeKey: scopedDedupeKey(
      unscopedDedupeKey(item.dedupeKey, item.accountId),
      accountId
    ),
  }
}

function matchingOutboxItem(
  items: readonly SyncOutboxItem[],
  input: SyncOutboxItemInput,
  accountId?: string
): SyncOutboxItem | undefined {
  const prepared = prepareOutboxInput(input, accountId)
  const key = scopedDedupeKey(prepared.dedupeKey, prepared.accountId)
  const exact = items.find(
    (item) => item.dedupeKey === key && belongsToScope(item, accountId)
  )
  if (exact || !accountId) return exact
  // A signed-in mutation can race the first adoption pass. Reuse its legacy
  // unscoped row instead of creating a second durable effect.
  return items.find(
    (item) =>
      item.accountId === undefined &&
      item.dedupeKey ===
        unscopedDedupeKey(prepared.dedupeKey, prepared.accountId)
  )
}

function mergeOutboxForScope(
  existing: SyncOutboxItem,
  input: SyncOutboxItemInput,
  now: number,
  accountId?: string
): SyncOutboxItem {
  const prepared = prepareOutboxInput(input, accountId)
  const current =
    accountId && existing.accountId === undefined
      ? rebindOutboxItem(existing, accountId)
      : existing
  return mergeSyncOutboxItem(current, prepared, now)
}

export function splitInFlightLocalMetadata(
  existing: SyncOutboxItem,
  input: SyncOutboxItemInput,
  now: number,
  idFactory: (prefix: string) => string = randomId
): { active: SyncOutboxItem; pending: SyncOutboxItem } | undefined {
  const isChangedLocalMetadata =
    existing.status === "in-flight" &&
    isLocalMetadataPayload(existing.payload) &&
    isLocalMetadataPayload(input.payload) &&
    JSON.stringify(existing.payload) !== JSON.stringify(input.payload)
  if (!isChangedLocalMetadata) return undefined

  // The durable store has a unique dedupe-key index. Keep the leased request
  // under a private key and give the latest edit the canonical key so later
  // edits continue to merge into that pending successor.
  const pending = normaliseSyncOutboxItem(
    { ...input, id: idFactory("outbox") },
    now
  )
  const active: SyncOutboxItem = {
    ...clone(existing),
    dedupeKey: `${existing.dedupeKey}:in-flight:${existing.id}`,
    supersededBy: pending.id,
  }
  return { active, pending }
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
    isStringArray(candidate.outboundSavedPointDeletionIds ?? []) &&
    (candidate.syncLeaseOwner === undefined ||
      typeof candidate.syncLeaseOwner === "string") &&
    (candidate.syncLeaseUntil === undefined ||
      (typeof candidate.syncLeaseUntil === "number" &&
        Number.isFinite(candidate.syncLeaseUntil) &&
        candidate.syncLeaseUntil >= 0))
  )
}

export function normaliseSyncOutboxItem(
  item: SyncOutboxItemInput,
  now: number
): SyncOutboxItem {
  const status = item.status ?? "pending"
  if (status === "in-flight") {
    throw new Error("New sync outbox items cannot start in-flight")
  }
  return {
    ...clone(item),
    id: item.id || randomId("outbox"),
    ...(item.accountId ? { accountId: item.accountId } : {}),
    dedupeKey: scopedDedupeKey(item.dedupeKey, item.accountId),
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

async function readStateInTransaction(
  transaction: IDBTransaction,
  accountId?: string,
  strict = false
): Promise<SyncState | null> {
  const stateStore = transaction.objectStore("sync-state")
  const id = stateId(accountId)
  const dedicated = await requestResult<StoredSyncState | undefined>(
    stateStore.get(id)
  )
  if (dedicated) {
    const { id: _id, ...state } = dedicated
    if (isSyncState(state)) return clone(state)
    if (strict) {
      transaction.abort()
      throw new Error("The durable sync state is invalid.")
    }
    return null
  }

  const prefsStore = transaction.objectStore("prefs")
  if (accountId) {
    // State written before account scoping is assigned to the first account
    // that successfully opens it. Removing the legacy record prevents a later
    // account from inheriting that cursor or tombstone memory.
    const legacyDedicated = await requestResult<StoredSyncState | undefined>(
      stateStore.get(SYNC_STATE_ID)
    )
    if (legacyDedicated) {
      const { id: _legacyId, ...legacyState } = legacyDedicated
      if (isSyncState(legacyState)) {
        stateStore.put({ id, ...clone(legacyState) })
        stateStore.delete(SYNC_STATE_ID)
        return clone(legacyState)
      }
    }
    const legacy = await requestResult<
      { key: string; value: unknown } | undefined
    >(prefsStore.get("syncState"))
    if (legacy && isSyncState(legacy.value)) {
      const state = clone(legacy.value)
      stateStore.put({ id, ...state })
      prefsStore.delete("syncState")
      return state
    }
    return null
  }

  const legacy = await requestResult<
    { key: string; value: unknown } | undefined
  >(prefsStore.get("syncState"))
  if (!legacy || !isSyncState(legacy.value)) return null
  const state = clone(legacy.value)
  stateStore.put({ id, ...state })
  return state
}

export interface IndexedDbSyncRepository extends SyncRepository {}

export function createIndexedDbSyncRepository(
  accountId?: string
): IndexedDbSyncRepository {
  async function loadState(): Promise<SyncState | null> {
    const db = await openStorageDatabase()
    if (!db) return null
    const transaction = db.transaction(["sync-state", "prefs"], "readwrite")
    const state = await readStateInTransaction(transaction, accountId)
    await transactionResult(transaction)
    return state
  }

  async function saveState(state: SyncState): Promise<void> {
    await commitStateAndOutbox({ state, complete: [] })
  }

  async function commitStateAndOutbox(
    commit: SyncStateCommit
  ): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction(["sync-state", "sync-outbox"], "readwrite")
    const outboxStore = tx.objectStore("sync-outbox")
    const existing = await requestResult<SyncOutboxItem[]>(outboxStore.getAll())
    const byId = new Map(existing.map((item) => [item.id, item]))
    for (const completion of commit.complete) {
      const item = byId.get(completion.id)
      if (
        !item ||
        !belongsToScope(item, accountId) ||
        !sameLease(item, completion.leaseId)
      ) {
        await transactionResult(tx)
        return false
      }
    }
    const now = Date.now()
    const byDedupeKey = new Map(existing.map((item) => [item.dedupeKey, item]))
    for (const item of commit.enqueue ?? []) {
      const prepared = prepareOutboxInput(item, accountId)
      const current = matchingOutboxItem(
        [...byId.values()],
        prepared,
        accountId
      )
      const scopedCurrent = current
        ? accountId && current.accountId === undefined
          ? rebindOutboxItem(current, accountId)
          : current
        : undefined
      const split = scopedCurrent
        ? splitInFlightLocalMetadata(scopedCurrent, prepared, now)
        : undefined
      if (split) {
        if (current && current.dedupeKey !== split.active.dedupeKey) {
          byDedupeKey.delete(current.dedupeKey)
        }
        byId.set(split.active.id, split.active)
        byId.set(split.pending.id, split.pending)
        byDedupeKey.set(split.active.dedupeKey, split.active)
        byDedupeKey.set(split.pending.dedupeKey, split.pending)
        continue
      }
      const next = current
        ? mergeOutboxForScope(current, prepared, now, accountId)
        : normaliseSyncOutboxItem(prepared, now)
      if (current && current.dedupeKey !== next.dedupeKey) {
        byDedupeKey.delete(current.dedupeKey)
      }
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
      id: stateId(accountId),
      ...clone(commit.state),
    })
    for (const item of byId.values()) outboxStore.put(item)
    await transactionResult(tx)
    return true
  }

  async function clearState(): Promise<void> {
    const db = await openStorageDatabase()
    if (!db) return
    const tx = db.transaction(["sync-state", "prefs"], "readwrite")
    tx.objectStore("sync-state").delete(stateId(accountId))
    if (!accountId) {
      // Remove the legacy copy once the unscoped record is explicitly cleared.
      tx.objectStore("prefs").delete("syncState")
    }
    await transactionResult(tx)
  }

  async function acquireSyncLease(options: SyncLeaseOptions): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction(["sync-state", "prefs"], "readwrite")
    const stateStore = tx.objectStore("sync-state")
    const loaded = await readStateInTransaction(tx, accountId, true)
    const state = loaded ?? clone(EMPTY_SYNC_STATE)

    if (
      state.syncLeaseOwner &&
      state.syncLeaseOwner !== options.owner &&
      (state.syncLeaseUntil ?? 0) > options.now
    ) {
      await transactionResult(tx)
      return false
    }
    stateStore.put({
      id: stateId(accountId),
      ...state,
      syncLeaseOwner: options.owner,
      syncLeaseUntil: options.now + Math.max(1, options.leaseMs),
    })
    await transactionResult(tx)
    return true
  }

  async function releaseSyncLease(owner: string): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction("sync-state", "readwrite")
    const store = tx.objectStore("sync-state")
    const record = await requestResult<StoredSyncState | undefined>(
      store.get(stateId(accountId))
    )
    if (!record || record.syncLeaseOwner !== owner) {
      await transactionResult(tx)
      return false
    }
    store.put({
      ...record,
      syncLeaseOwner: undefined,
      syncLeaseUntil: undefined,
    })
    await transactionResult(tx)
    return true
  }

  async function enqueueOutbox(
    item: SyncOutboxItemInput
  ): Promise<SyncOutboxItem> {
    const db = await openStorageDatabase()
    if (!db) throw new Error("IndexedDB is unavailable for sync outbox work")
    const now = item.updatedAt ?? item.createdAt ?? Date.now()
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const index = store.index("dedupeKey")
    const prepared = prepareOutboxInput(item, accountId)
    const preparedKey = scopedDedupeKey(prepared.dedupeKey, prepared.accountId)
    const existing = await requestResult<SyncOutboxItem | undefined>(
      index.get(preparedKey)
    )
    const legacy =
      !existing && accountId
        ? await requestResult<SyncOutboxItem | undefined>(
            index.get(unscopedDedupeKey(prepared.dedupeKey, prepared.accountId))
          )
        : undefined
    const current = existing ?? legacy
    const scopedCurrent = current
      ? accountId && current.accountId === undefined
        ? rebindOutboxItem(current, accountId)
        : current
      : undefined
    const split = scopedCurrent
      ? splitInFlightLocalMetadata(scopedCurrent, prepared, now)
      : undefined
    if (split) {
      store.put(split.active)
      store.put(split.pending)
      await transactionResult(tx)
      return clone(split.pending)
    }
    const next = current
      ? mergeOutboxForScope(current, prepared, now, accountId)
      : normaliseSyncOutboxItem(prepared, now)
    store.put(next)
    await transactionResult(tx)
    return clone(next)
  }

  async function loadOutbox(): Promise<SyncOutboxItem[]> {
    const db = await openStorageDatabase()
    if (!db) return []
    const tx = db.transaction("sync-outbox", "readonly")
    const items = await requestResult<SyncOutboxItem[]>(
      tx.objectStore("sync-outbox").getAll()
    )
    await transactionResult(tx)
    return orderOutbox(
      items.filter((item) => belongsToScope(item, accountId)).map(clone)
    )
  }

  async function claimOutbox(
    options: ClaimOutboxOptions
  ): Promise<SyncOutboxItem[]> {
    const db = await openStorageDatabase()
    if (!db) return []
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const requestedIds = options.ids ? new Set(options.ids) : null
    const items = orderOutbox(
      (await requestResult<SyncOutboxItem[]>(store.getAll())).filter(
        (item) =>
          belongsToScope(item, accountId) &&
          canClaim(item, options.now) &&
          (requestedIds === null || requestedIds.has(item.id))
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

  async function completeOutbox(id: string, leaseId: string): Promise<boolean> {
    const db = await openStorageDatabase()
    if (!db) return false
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const item = await requestResult<SyncOutboxItem | undefined>(store.get(id))
    if (
      !item ||
      !belongsToScope(item, accountId) ||
      !sameLease(item, leaseId)
    ) {
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

  async function failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null> {
    const db = await openStorageDatabase()
    if (!db) return null
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const item = await requestResult<SyncOutboxItem | undefined>(store.get(id))
    if (
      !item ||
      !belongsToScope(item, accountId) ||
      !sameLease(item, leaseId)
    ) {
      await transactionResult(tx)
      return null
    }
    const next: SyncOutboxItem = {
      ...item,
      status: item.supersededBy
        ? "complete"
        : failure.retryable
          ? "retryable"
          : "permanent",
      availableAt: failure.retryAt ?? item.availableAt,
      updatedAt: failure.failedAt,
      ...(item.supersededBy
        ? { lastFailure: undefined }
        : { lastFailure: clone(failure) }),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    }
    store.put(next)
    await transactionResult(tx)
    return clone(next)
  }

  async function adoptUnscopedOutbox(): Promise<number> {
    if (!accountId) return 0
    const db = await openStorageDatabase()
    if (!db) return 0
    const tx = db.transaction("sync-outbox", "readwrite")
    const store = tx.objectStore("sync-outbox")
    const existing = await requestResult<SyncOutboxItem[]>(store.getAll())
    const byDedupeKey = new Map(existing.map((item) => [item.dedupeKey, item]))
    let adopted = 0
    for (const item of existing) {
      if (item.accountId !== undefined) continue
      const rebound = rebindOutboxItem(item, accountId)
      const current = byDedupeKey.get(rebound.dedupeKey)
      if (current && current.id !== item.id) {
        const merged = mergeSyncOutboxItem(
          current,
          { ...item, accountId },
          Date.now()
        )
        store.put(merged)
        store.delete(item.id)
        byDedupeKey.set(merged.dedupeKey, merged)
      } else {
        store.put(rebound)
        byDedupeKey.set(rebound.dedupeKey, rebound)
      }
      adopted++
    }
    await transactionResult(tx)
    return adopted
  }

  return {
    loadState,
    saveState,
    commitStateAndOutbox,
    clearState,
    acquireSyncLease,
    releaseSyncLease,
    enqueueOutbox,
    loadOutbox,
    claimOutbox,
    completeOutbox,
    failOutbox,
    adoptUnscopedOutbox,
  }
}

export function mergeSyncOutboxItem(
  existing: SyncOutboxItem,
  input: SyncOutboxItemInput,
  now: number
): SyncOutboxItem {
  // Replaying an already completed operation is a no-op. Active leases are
  // also preserved so a second tab cannot replace a request another tab owns.
  if (existing.status === "in-flight") return clone(existing)
  const existingLocalMetadata = isLocalMetadataPayload(existing.payload)
  const incomingLocalMetadata = isLocalMetadataPayload(input.payload)
  if (
    existing.status === "complete" &&
    (!existingLocalMetadata ||
      !incomingLocalMetadata ||
      JSON.stringify(existing.payload) === JSON.stringify(input.payload))
  ) {
    return clone(existing)
  }
  const incoming = normaliseSyncOutboxItem(input, now)
  const owner = incoming.accountId ?? existing.accountId
  const incomingBaseKey = unscopedDedupeKey(
    incoming.dedupeKey,
    incoming.accountId
  )
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    ...(owner ? { accountId: owner } : {}),
    dedupeKey: scopedDedupeKey(incomingBaseKey, owner),
    attempts: existing.attempts,
    createdAt: existing.createdAt,
    status: incoming.status,
    updatedAt: now,
    lastFailure: undefined,
  }
}

function isLocalMetadataPayload(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "local-metadata" &&
    (value as { source?: unknown }).source === "local"
  )
}

export interface MemorySyncRepositoryOptions {
  accountId?: string
  now?: () => number
  idFactory?: (prefix: string) => string
  storage?: MemorySyncRepositoryStorage
}

export interface MemorySyncRepositoryStorage {
  states: Map<string, SyncState>
  items: Map<string, SyncOutboxItem>
}

export function createMemorySyncRepositoryStorage(): MemorySyncRepositoryStorage {
  return { states: new Map(), items: new Map() }
}

export interface MemorySyncRepository extends SyncRepository {}

export function createMemorySyncRepository(
  options: MemorySyncRepositoryOptions = {}
): MemorySyncRepository {
  const accountId = options.accountId
  const storage = options.storage ?? createMemorySyncRepositoryStorage()
  const items = storage.items
  const now = options.now ?? (() => Date.now())
  const idFactory = options.idFactory ?? randomId

  function readState(): SyncState | null {
    const key = stateId(accountId)
    const current = storage.states.get(key)
    if (current) return clone(current)
    if (!accountId) return null
    const legacy = storage.states.get(SYNC_STATE_ID)
    if (!legacy) return null
    const migrated = clone(legacy)
    storage.states.set(key, migrated)
    storage.states.delete(SYNC_STATE_ID)
    return clone(migrated)
  }

  async function loadState(): Promise<SyncState | null> {
    return readState()
  }

  async function saveState(nextState: SyncState): Promise<void> {
    storage.states.set(stateId(accountId), clone(nextState))
  }

  async function commitStateAndOutbox(
    commit: SyncStateCommit
  ): Promise<boolean> {
    for (const completion of commit.complete) {
      const item = items.get(completion.id)
      if (
        !item ||
        !belongsToScope(item, accountId) ||
        !sameLease(item, completion.leaseId)
      ) {
        return false
      }
    }
    storage.states.set(stateId(accountId), clone(commit.state))
    for (const input of commit.enqueue ?? []) {
      const prepared = prepareOutboxInput(input, accountId)
      const current = matchingOutboxItem(
        [...items.values()],
        prepared,
        accountId
      )
      const itemNow = input.updatedAt ?? input.createdAt ?? now()
      const scopedCurrent = current
        ? accountId && current.accountId === undefined
          ? rebindOutboxItem(current, accountId)
          : current
        : undefined
      const split = scopedCurrent
        ? splitInFlightLocalMetadata(
            scopedCurrent,
            prepared,
            itemNow,
            idFactory
          )
        : undefined
      if (split) {
        items.set(split.active.id, clone(split.active))
        items.set(split.pending.id, clone(split.pending))
        continue
      }
      const next = current
        ? mergeOutboxForScope(current, prepared, itemNow, accountId)
        : normaliseSyncOutboxItem(
            { ...prepared, id: prepared.id || idFactory("outbox") },
            itemNow
          )
      items.set(next.id, clone(next))
    }
    for (const completion of commit.complete) {
      const item = items.get(completion.id)!
      items.set(item.id, {
        ...item,
        status: "complete",
        updatedAt: now(),
        leaseId: undefined,
        leaseOwner: undefined,
        leaseUntil: undefined,
      })
    }
    return true
  }

  async function clearState(): Promise<void> {
    storage.states.delete(stateId(accountId))
  }

  async function acquireSyncLease(options: SyncLeaseOptions): Promise<boolean> {
    const currentState = clone(readState() ?? EMPTY_SYNC_STATE)
    if (
      currentState.syncLeaseOwner &&
      currentState.syncLeaseOwner !== options.owner &&
      (currentState.syncLeaseUntil ?? 0) > options.now
    ) {
      return false
    }
    storage.states.set(stateId(accountId), {
      ...currentState,
      syncLeaseOwner: options.owner,
      syncLeaseUntil: options.now + Math.max(1, options.leaseMs),
    })
    return true
  }

  async function releaseSyncLease(owner: string): Promise<boolean> {
    const state = storage.states.get(stateId(accountId))
    if (!state || state.syncLeaseOwner !== owner) return false
    storage.states.set(stateId(accountId), {
      ...state,
      syncLeaseOwner: undefined,
      syncLeaseUntil: undefined,
    })
    return true
  }

  async function enqueueOutbox(
    item: SyncOutboxItemInput
  ): Promise<SyncOutboxItem> {
    const prepared = prepareOutboxInput(item, accountId)
    const itemNow = prepared.updatedAt ?? prepared.createdAt ?? now()
    const existing = matchingOutboxItem(
      [...items.values()],
      prepared,
      accountId
    )
    const scopedExisting = existing
      ? accountId && existing.accountId === undefined
        ? rebindOutboxItem(existing, accountId)
        : existing
      : undefined
    const split = scopedExisting
      ? splitInFlightLocalMetadata(scopedExisting, prepared, itemNow, idFactory)
      : undefined
    if (split) {
      items.set(split.active.id, clone(split.active))
      items.set(split.pending.id, clone(split.pending))
      return clone(split.pending)
    }
    const next = existing
      ? mergeOutboxForScope(existing, prepared, itemNow, accountId)
      : normaliseSyncOutboxItem(
          { ...prepared, id: prepared.id || idFactory("outbox") },
          itemNow
        )
    items.set(next.id, clone(next))
    return clone(next)
  }

  async function loadOutbox(): Promise<SyncOutboxItem[]> {
    return orderOutbox(
      [...items.values()]
        .filter((item) => belongsToScope(item, accountId))
        .map(clone)
    )
  }

  async function claimOutbox(
    options: ClaimOutboxOptions
  ): Promise<SyncOutboxItem[]> {
    const requestedIds = options.ids ? new Set(options.ids) : null
    const candidates = orderOutbox(
      [...items.values()].filter(
        (item) =>
          belongsToScope(item, accountId) &&
          canClaim(item, options.now) &&
          (requestedIds === null || requestedIds.has(item.id))
      )
    ).slice(0, Math.max(0, options.limit ?? 10))
    const claimed = candidates.map((item, index) => {
      const next = claimItem(item, options, index)
      items.set(next.id, clone(next))
      return next
    })
    return claimed.map(clone)
  }

  async function completeOutbox(id: string, leaseId: string): Promise<boolean> {
    const item = items.get(id)
    if (
      !item ||
      !belongsToScope(item, accountId) ||
      !sameLease(item, leaseId)
    ) {
      return false
    }
    items.set(id, {
      ...item,
      status: "complete",
      updatedAt: now(),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    })
    return true
  }

  async function failOutbox(
    id: string,
    leaseId: string,
    failure: SyncOutboxFailure
  ): Promise<SyncOutboxItem | null> {
    const item = items.get(id)
    if (
      !item ||
      !belongsToScope(item, accountId) ||
      !sameLease(item, leaseId)
    ) {
      return null
    }
    const next: SyncOutboxItem = {
      ...item,
      status: item.supersededBy
        ? "complete"
        : failure.retryable
          ? "retryable"
          : "permanent",
      availableAt: failure.retryAt ?? item.availableAt,
      updatedAt: failure.failedAt,
      ...(item.supersededBy
        ? { lastFailure: undefined }
        : { lastFailure: clone(failure) }),
      leaseId: undefined,
      leaseOwner: undefined,
      leaseUntil: undefined,
    }
    items.set(id, clone(next))
    return clone(next)
  }

  async function adoptUnscopedOutbox(): Promise<number> {
    if (!accountId) return 0
    const existing = [...items.values()]
    const byDedupeKey = new Map(existing.map((item) => [item.dedupeKey, item]))
    let adopted = 0
    for (const item of existing) {
      if (item.accountId !== undefined) continue
      const rebound = rebindOutboxItem(item, accountId)
      const current = byDedupeKey.get(rebound.dedupeKey)
      if (current && current.id !== item.id) {
        const merged = mergeSyncOutboxItem(
          current,
          { ...item, accountId },
          now()
        )
        items.set(merged.id, clone(merged))
        items.delete(item.id)
        byDedupeKey.set(merged.dedupeKey, merged)
      } else {
        items.set(rebound.id, clone(rebound))
        byDedupeKey.set(rebound.dedupeKey, rebound)
      }
      adopted++
    }
    return adopted
  }

  return {
    loadState,
    saveState,
    commitStateAndOutbox,
    clearState,
    acquireSyncLease,
    releaseSyncLease,
    enqueueOutbox,
    loadOutbox,
    claimOutbox,
    completeOutbox,
    failOutbox,
    adoptUnscopedOutbox,
  }
}
