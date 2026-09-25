/**
 * Activity synchronisation.
 *
 * Activities are content-addressed and immutable, so there is nothing to merge:
 * a hash the server lacks is uploaded, a hash this device lacks is downloaded,
 * and a tombstone deletes locally. That is the whole conflict model.
 *
 * Every step is individually resumable — a failed activity is simply retried on
 * the next run, and the manifest cursor only advances after a clean page.
 */

import { useSyncExternalStore } from "react"
import type {
  SavedPointDeleteResponse,
  SavedPointManifestPage,
  SavedPointTombstone,
  SavedPointUpsertInput,
  SavedPointUpsertResponse,
} from "~shared/api"
import { SYNC_CONCURRENCY } from "~shared/constants"
import type { SavedPoint } from "~shared/saved-points"
import type { ParsedActivity } from "~/types/activities"
import {
  emptySavedPointSyncState,
  loadAccountSavedPointSyncStates,
  loadSavedPointSyncState,
  updateSavedPointSyncState,
  deleteSavedPoint as deleteSavedPointFromIdb,
  loadSavedPoints,
  saveSavedPoint,
  saveSavedPoints,
} from "~/lib/storage"
import {
  activityLibrary,
  initializeActivityLibrary,
  mapStore,
} from "~/lib/mapStore"
import { backfillContentHashes } from "~/lib/activityHash"
import { createUuid } from "~/lib/uuid"
import { recordDiagnostic } from "~/lib/diagnostics"
import { apiRaw, friendlyMessage } from "./apiClient"
import { canSync, getAuthState, subscribeAuth } from "./authStore"
import { isServerEnabled } from "./config"
import { createApiSyncTransport } from "./sync/transport"
import {
  createIndexedDbSyncRepository,
  type IndexedDbSyncRepository,
} from "./sync/repository"
import { createActivitySyncExecutor } from "./sync/executor"
import {
  isSyncCancellationError,
  throwIfSyncAborted,
} from "./sync/cancellation"
import { createSyncScheduler } from "./sync/scheduler"
import {
  describeSyncStatus,
  getSyncStatus,
  subscribeSyncStatus,
  applySyncOutboxSummary,
  setSyncStatus,
  summarizeSyncOutbox,
  useSyncStatus,
  type SyncStatus,
  type SyncStatusUpdate,
} from "./sync/status"
import {
  createActivityDeleteOutboxItem,
  createActivityUploadOutboxItem,
  hasLocalActivityEffectSource,
} from "./sync/activityEffects"

// ─── Status, published to the drawer ──────────────────────────────────────────

export type { SyncStatus }
export { describeSyncStatus, useSyncStatus }
const setStatus = setSyncStatus
if (!isServerEnabled) setStatus({ phase: "disabled" })

// ─── Suspension ───────────────────────────────────────────────────────────────

/**
 * Deliberately in-memory, so a reload clears it.
 *
 * Deleting activities locally while leaving them on the server is a legitimate
 * thing to want, but the next automatic sync would faithfully download them
 * straight back — the delete would look like it never happened. Pausing until
 * the page is reloaded makes the local state stick for as long as the user is
 * looking at it, without inventing a persistent "don't sync" mode they would
 * then have to discover how to turn off.
 */
let isSuspended = false

export function isAutoSyncSuspended(): boolean {
  return isSuspended
}

export function useIsAutoSyncSuspended(): boolean {
  return useSyncExternalStore(
    subscribeSyncStatus,
    () => isSuspended,
    () => isSuspended
  )
}

/** Pause automatic syncing until the page reloads. */
export function suspendAutoSync(reason: string): void {
  if (isSuspended) return
  isSuspended = true
  console.debug("[sync] auto-sync suspended:", reason)
  setStatus({
    phase: "suspended",
    message: "Sync paused after a local change.",
  })
}

/** Resume. Only ever called by an explicit user action. */
export function resumeAutoSync(): void {
  if (!isSuspended) return
  isSuspended = false
  console.debug("[sync] auto-sync resumed")
  setStatus({ phase: "idle", message: null })
}

// ─── Change notification ──────────────────────────────────────────────────────

export interface SyncChanges {
  /** How many activities arrived from the server. */
  downloadedCount: number
  /** How many existing activities received server-side metadata updates. */
  updatedCount: number
  /** Local ids of activities a tombstone removed. */
  deletedIds: string[]
  /** Saved points that arrived or changed on the server. */
  savedPoints?: SavedPoint[]
  /** Saved-point ids removed by a remote tombstone. */
  deletedSavedPointIds?: string[]
}

let onChanged: ((changes: SyncChanges) => void) | null = null

/**
 * Registered by `home.tsx`. Activity changes are published through the
 * ActivityLibrary; rebuilding the fog after a remote delete and dropping
 * deleted activities out of the selection are React concerns that belong in
 * the route.
 */
export function setSyncChangeHandler(
  handler: ((changes: SyncChanges) => void) | null
): void {
  onChanged = handler
}

// ─── Run loop ─────────────────────────────────────────────────────────────────

// Do not construct sync resources in a serverless build. Besides keeping the
// disabled bundle inert, this prevents a future transport constructor from
// accidentally becoming a network prerequisite for local-only use.
const syncTransport = isServerEnabled ? createApiSyncTransport() : null
const activitySyncRepository = isServerEnabled
  ? createIndexedDbSyncRepository()
  : null
const accountSyncRepositories = new Map<string, IndexedDbSyncRepository>()
const syncOwner = isServerEnabled ? `sync-tab:${createUuid()}` : null
const SYNC_LEASE_MS = 90_000
let nextSyncRunId = 0

function repositoryForAccount(
  accountId: string
): IndexedDbSyncRepository | null {
  if (!activitySyncRepository) return null
  const current = accountSyncRepositories.get(accountId)
  if (current) return current
  const repository = createIndexedDbSyncRepository(accountId)
  accountSyncRepositories.set(accountId, repository)
  return repository
}

function repositoryForCurrentAccount(): IndexedDbSyncRepository | null {
  const auth = getAuthState()
  return auth.status === "signedIn"
    ? repositoryForAccount(auth.user.id)
    : activitySyncRepository
}

function isCurrentSignedInAccount(accountId: string): boolean {
  const auth = getAuthState()
  return auth.status === "signedIn" && auth.user.id === accountId
}

function throwIfSavedPointAccountChanged(accountId: string): void {
  if (isCurrentSignedInAccount(accountId)) return
  const error = new Error("Saved-point sync account changed")
  error.name = "AbortError"
  throw error
}

let savedPointOperationTail: Promise<void> = Promise.resolve()

/**
 * Serialize saved-point network work with local state transitions. Web Locks
 * covers separate tabs; the promise tail keeps operations in this tab ordered
 * even in browsers without that API. IndexedDB updates remain transactional as
 * the final safety net for a legacy browser.
 */
async function withSavedPointSyncLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  let release!: () => void
  const previous = savedPointOperationTail
  savedPointOperationTail = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await previous
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(
        "fogofwalk:saved-points",
        { mode: "exclusive" },
        operation
      )
    }
    return await operation()
  } finally {
    release()
  }
}

function savedPointStateIds(
  state: Awaited<ReturnType<typeof loadSavedPointSyncState>>
): Set<string> {
  return new Set([
    ...(state?.ownedIds ?? []),
    ...(state?.serverPointIds ?? []),
    ...(state?.outboundIds ?? []),
    ...(state?.outboundDeletionIds ?? []),
  ])
}

async function foreignSavedPointIds(accountId: string): Promise<Set<string>> {
  const states = await loadAccountSavedPointSyncStates()
  const ids = new Set<string>()
  for (const [ownerId, state] of states) {
    if (ownerId === accountId) continue
    for (const id of savedPointStateIds(state)) ids.add(id)
  }
  return ids
}

async function foreignActivityHashes(accountId: string): Promise<Set<string>> {
  if (!activitySyncRepository) return new Set()
  const hashes = new Set<string>()
  for (const item of await activitySyncRepository.loadOutbox()) {
    if (!item.accountId || item.accountId === accountId) continue
    if (!hasLocalActivityEffectSource(item.payload)) continue
    const contentHash = (item.payload as { contentHash?: unknown }).contentHash
    if (typeof contentHash === "string") hashes.add(contentHash)
  }
  return hashes
}

async function publishOutboxStatus(
  update: SyncStatusUpdate,
  repository: IndexedDbSyncRepository | null = repositoryForCurrentAccount()
): Promise<ReturnType<typeof summarizeSyncOutbox> | null> {
  if (!repository) {
    setStatus(update)
    return null
  }
  try {
    const summary = summarizeSyncOutbox(await repository.loadOutbox())
    applySyncOutboxSummary(summary, update)
    return summary
  } catch {
    // Keep the operation result visible even if the status read itself fails.
    setStatus(update)
    return null
  }
}

async function acquireSyncLeadership(
  run: () => Promise<void>
): Promise<boolean> {
  const auth = getAuthState()
  const repository =
    auth.status === "signedIn" && auth.canSync
      ? repositoryForAccount(auth.user.id)
      : null
  if (!repository || !syncOwner) return false
  if (auth.status !== "signedIn") return false
  const accountId = auth.user.id
  await withSavedPointSyncLock(async () => {
    await loadSavedPointSyncState(accountId)
  })
  if (!isCurrentSignedInAccount(accountId)) return false
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      `fogofwalk:sync:${accountId}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return false
        // A navigation can destroy a page while an effect is leased. The
        // account lock proves that no other sync run owns the account now, so
        // those abandoned leases are safe to hand to this run.
        await repository.recoverInFlightOutbox?.()
        await run()
        return true
      }
    )
  }

  const acquired = await repository.acquireSyncLease({
    owner: syncOwner,
    now: Date.now(),
    leaseMs: SYNC_LEASE_MS,
  })
  if (!acquired) return false
  try {
    await repository.recoverInFlightOutbox?.()
    await run()
    return true
  } finally {
    await repository.releaseSyncLease(syncOwner)
  }
}

const syncScheduler = isServerEnabled
  ? createSyncScheduler({
      enabled: canSync,
      execute: (reason) => syncOnce(reason),
      acquireLeadership: acquireSyncLeadership,
      onError: (error) => {
        console.warn("[sync] scheduler failed:", error)
        void publishOutboxStatus({
          phase: "error",
          message: friendlyMessage(error),
          lastSyncAt:
            getSyncStatus().phase === "syncing"
              ? null
              : getSyncStatus().lastSyncAt,
        })
      },
    })
  : null

interface ActiveSyncRun {
  controller: AbortController
  accountId: string
}

let activeSyncRun: ActiveSyncRun | null = null

subscribeAuth(() => {
  const active = activeSyncRun
  if (!active) return
  const auth = getAuthState()
  if (
    auth.status === "signedIn" &&
    auth.canSync &&
    auth.user.id === active.accountId
  ) {
    return
  }
  active.controller.abort()
  if (auth.status === "signedIn" && auth.canSync) {
    syncScheduler?.trigger("account-change")
  }
})

async function loadActivitySyncState() {
  const repository = repositoryForCurrentAccount()
  if (!repository) {
    return { cursor: 0, lastSyncAt: 0, serverHashes: [] }
  }
  return (
    (await repository.loadState()) ?? {
      cursor: 0,
      lastSyncAt: 0,
      serverHashes: [],
    }
  )
}

/**
 * Ask for a sync. Cheap and safe to call from anywhere — it no-ops when the
 * user is signed out or not approved, and coalesces concurrent requests.
 *
 * Pass `manual` for a request the user made explicitly (the "Sync now"
 * button). Only that clears a suspension; every automatic trigger is dropped
 * while one is in effect.
 */
export function requestSync(
  reason: string,
  options: { manual?: boolean } = {}
): void {
  if (!canSync() || !syncScheduler) return
  if (isSuspended) {
    if (!options.manual) {
      console.debug("[sync] skipped while suspended:", reason)
      return
    }
    resumeAutoSync()
  }
  syncScheduler.trigger(reason)
}

/** How often to poll for other devices' changes while the tab is visible. */
const SYNC_POLL_MS = 5 * 60 * 1000

/**
 * Keep a long-lived tab up to date.
 *
 * Without this, sync only ran at sign-in and after an import, so an activity added
 * on another device never appeared until a reload — which reads exactly like
 * "sync doesn't download anything". Focus covers the common case (switch back
 * to the tab), the interval covers a tab left open.
 */
export function startSyncScheduler(): () => void {
  if (!isServerEnabled || !syncScheduler) return () => {}

  const onFocus = () => {
    if (document.visibilityState === "visible") requestSync("focus")
  }
  window.addEventListener("focus", onFocus)
  document.addEventListener("visibilitychange", onFocus)
  window.addEventListener("online", onFocus)

  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") requestSync("poll")
  }, SYNC_POLL_MS)

  return () => {
    window.removeEventListener("focus", onFocus)
    document.removeEventListener("visibilitychange", onFocus)
    window.removeEventListener("online", onFocus)
    window.clearInterval(timer)
  }
}

async function syncOnce(reason: string): Promise<void> {
  if (!isServerEnabled || !activitySyncRepository || !syncTransport) return
  const auth = getAuthState()
  if (auth.status !== "signedIn" || !auth.canSync) return
  const repository = repositoryForAccount(auth.user.id)
  if (!repository) return
  const active: ActiveSyncRun = {
    controller: new AbortController(),
    accountId: auth.user.id,
  }
  activeSyncRun = active
  const { signal } = active.controller
  const previousStatus = getSyncStatus()
  const lastSyncAt =
    previousStatus.phase === "syncing" ? null : previousStatus.lastSyncAt
  const runId = ++nextSyncRunId
  const operationId = `sync-${runId}`
  const startedAt = Date.now()
  setStatus({
    phase: "syncing",
    runId,
    trigger: reason,
    done: 0,
    total: 0,
    cursorHeld: false,
    message: null,
  })
  recordDiagnostic({
    subsystem: "sync",
    operationId,
    stage: "run",
    result: "started",
  })
  console.debug("[sync] start", reason)

  try {
    throwIfSyncAborted(signal)
    // Imports made before the first authenticated run are intentionally
    // unscoped. Adopt them before any account-specific work can be sent.
    await repository.adoptUnscopedOutbox()
    throwIfSyncAborted(signal)
    // Saved points have their own manifest cursor and are intentionally kept
    // outside activity upload pacing. Reconcile them before activities.
    await withSavedPointSyncLock(() => syncSavedPoints(signal, auth.user.id))
    throwIfSyncAborted(signal)
    await activityLibrary.initializeSummarySnapshot()
    throwIfSyncAborted(signal)

    // Activities imported before sync existed have no hash yet. Hash
    // backfill is the exceptional path that genuinely needs full geometry;
    // an ordinary metadata sync stays summary-only.
    const summaries = activityLibrary.getSummarySnapshot().summaries
    if (summaries.some((activity) => !activity.contentHash)) {
      await initializeActivityLibrary()
      throwIfSyncAborted(signal)
      const backfillCandidates = activityLibrary
        .getSnapshot()
        .activities.map((activity) => structuredClone(activity))
      const backfilled = await backfillContentHashes(backfillCandidates)
      throwIfSyncAborted(signal)
      if (backfilled.length > 0) {
        throwIfSyncAborted(signal)
        await activityLibrary.dispatch({
          type: "applyRemote",
          operationId: createUuid(),
          changes: backfilled.map((activity) => ({
            type: "upsert" as const,
            activity,
          })),
        })
        throwIfSyncAborted(signal)
      }
    }

    const excludedLocalHashes = await foreignActivityHashes(auth.user.id)
    await runActivitySync(
      lastSyncAt,
      operationId,
      startedAt,
      signal,
      repository,
      excludedLocalHashes
    )
    return
  } catch (err) {
    if (signal.aborted || isSyncCancellationError(err)) {
      if (activeSyncRun === active) {
        setStatus({
          phase: "idle",
          message: null,
          cursorHeld: false,
        })
      }
      console.debug("[sync] cancelled", reason)
      return
    }
    console.warn("[sync] failed:", err)
    recordDiagnostic({
      subsystem: "sync",
      operationId,
      stage: "run",
      durationMs: Date.now() - startedAt,
      result: "failed",
      errorCode: "sync-failed",
      retryability: "retryable",
    })
    await publishOutboxStatus(
      {
        phase: "error",
        message: friendlyMessage(err),
        lastSyncAt,
        cursorHeld: false,
      },
      repository
    )
  } finally {
    if (activeSyncRun === active) activeSyncRun = null
  }
}

async function runActivitySync(
  lastSyncAt: number | null,
  operationId: string,
  startedAt: number,
  signal: AbortSignal,
  repository: IndexedDbSyncRepository,
  excludedLocalHashes: ReadonlySet<string>
): Promise<void> {
  if (!syncTransport) return
  throwIfSyncAborted(signal)
  setStatus({ phase: "syncing", done: 0, total: 0 })
  const result = await createActivitySyncExecutor({
    repository,
    library: activityLibrary,
    transport: syncTransport,
    excludedLocalHashes: [...excludedLocalHashes],
    signal,
    onProgress: ({ done, total }) => {
      setStatus({ phase: "syncing", done, total })
      recordDiagnostic({
        subsystem: "sync",
        operationId,
        stage: "page",
        itemCount: total,
        result: "progress",
      })
    },
  }).run()
  throwIfSyncAborted(signal)

  // Metadata-only manifest echoes already reach every live projection through
  // ActivityLibrary. Notify the route only for membership changes that it
  // must reconcile locally; otherwise Home would revalidate its bootstrap
  // loader for a change that cannot affect map geometry.
  if (result.downloadedCount > 0 || result.deletedIds.length > 0) {
    onChanged?.({
      downloadedCount: result.downloadedCount,
      updatedCount: result.updatedCount,
      deletedIds: result.deletedIds,
    })
  }

  if (result.failures.length > 0) {
    const permanent = result.failures.find((failure) => !failure.retryable)
    const message =
      permanent?.message ??
      (result.cursorHeld
        ? "Some activities couldn't be received"
        : "Some activities couldn't be uploaded")
    const summary = await publishOutboxStatus(
      {
        phase: result.cursorHeld ? "partial" : "waiting",
        message,
        lastSyncAt:
          result.state.lastSyncAt > 0 ? result.state.lastSyncAt : lastSyncAt,
        cursorHeld: result.cursorHeld,
      },
      repository
    )
    if (permanent || summary?.permanentCount) {
      setStatus({ phase: "permanent" })
    }
    recordDiagnostic({
      subsystem: "sync",
      operationId,
      stage: "complete",
      durationMs: Date.now() - startedAt,
      itemCount:
        result.downloadedCount + result.updatedCount + result.deletedIds.length,
      result: permanent || summary?.permanentCount ? "failed" : "partial",
      errorCode: permanent ? "permanent-sync-failure" : "sync-effects-pending",
      retryability: permanent ? "permanent" : "retryable",
    })
    return
  }

  const summary = await publishOutboxStatus(
    {
      phase: "idle",
      lastSyncAt: result.state.lastSyncAt,
      cursorHeld: false,
      message: null,
    },
    repository
  )
  if (summary?.permanentCount) {
    setStatus({
      phase: "permanent",
      message: "Some local changes cannot be synced.",
    })
  }
  recordDiagnostic({
    subsystem: "sync",
    operationId,
    stage: "complete",
    durationMs: Date.now() - startedAt,
    itemCount:
      result.downloadedCount + result.updatedCount + result.deletedIds.length,
    result: summary?.permanentCount ? "failed" : "success",
    ...(summary?.permanentCount
      ? { errorCode: "permanent-sync-failure", retryability: "permanent" }
      : {}),
  })
  console.debug("[sync] done")
}

/** Reconcile remote point changes/deletions, then upload local outbound edits. */
async function syncSavedPoints(
  signal: AbortSignal | undefined,
  accountId: string
): Promise<void> {
  throwIfSyncAborted(signal)
  throwIfSavedPointAccountChanged(accountId)
  const state = await loadSavedPointSyncState(accountId)
  throwIfSyncAborted(signal)
  throwIfSavedPointAccountChanged(accountId)
  const foreignOwnedIds = await foreignSavedPointIds(accountId)
  throwIfSyncAborted(signal)
  throwIfSavedPointAccountChanged(accountId)
  const since = state?.cursor ?? 0
  const isFromScratch = since === 0
  const { serverPoints, deletions, cursor } = await fetchSavedPointsManifest(
    since,
    signal
  )
  throwIfSyncAborted(signal)
  const localById = new Map(
    (await loadSavedPoints()).map((point) => [point.id, point])
  )
  throwIfSyncAborted(signal)
  throwIfSavedPointAccountChanged(accountId)
  const ownedIds = savedPointStateIds(state)
  for (const point of localById.values()) {
    if (!foreignOwnedIds.has(point.id)) ownedIds.add(point.id)
  }
  const serverIds = new Set(isFromScratch ? [] : (state?.serverPointIds ?? []))
  for (const point of serverPoints) serverIds.add(point.id)
  for (const tombstone of deletions) serverIds.delete(tombstone.id)

  const applied = new Map<string, number>(
    Object.entries(state?.appliedTombstones ?? {})
  )
  const freshTombstones = deletions.filter(
    (tombstone) => applied.get(tombstone.id) !== tombstone.deletedAt
  )
  const dirtyIds = new Set(state?.outboundIds ?? [])
  const outboundDeletionIds = new Set(state?.outboundDeletionIds ?? [])
  const deletedIds: string[] = []
  if (!isFromScratch) {
    for (const tombstone of freshTombstones) {
      throwIfSyncAborted(signal)
      if (localById.has(tombstone.id)) {
        await deleteSavedPointFromIdb(tombstone.id)
        throwIfSyncAborted(signal)
        localById.delete(tombstone.id)
        deletedIds.push(tombstone.id)
      }
      dirtyIds.delete(tombstone.id)
      outboundDeletionIds.delete(tombstone.id)
    }
  }
  for (const tombstone of deletions)
    applied.set(tombstone.id, tombstone.deletedAt)

  // Keep unsent local edits until their upsert wins a server timestamp. Other
  // manifest records are the server's last write and replace local copies.
  const remoteUpdates = serverPoints.filter(
    (point) => !dirtyIds.has(point.id) && !outboundDeletionIds.has(point.id)
  )
  if (remoteUpdates.length > 0) {
    throwIfSyncAborted(signal)
    await saveSavedPoints(remoteUpdates)
    throwIfSyncAborted(signal)
    throwIfSavedPointAccountChanged(accountId)
    for (const point of remoteUpdates) localById.set(point.id, point)
    for (const point of remoteUpdates) ownedIds.add(point.id)
  }

  const deletedThisWindow = new Set(freshTombstones.map((tomb) => tomb.id))
  const deletionFailures = await pooled(
    [...outboundDeletionIds],
    async (id) => {
      const deletedAt = await deleteSavedPointOnServer(id, signal, accountId)
      throwIfSyncAborted(signal)
      serverIds.delete(id)
      dirtyIds.delete(id)
      outboundDeletionIds.delete(id)
      applied.set(id, deletedAt)
    },
    signal
  )
  throwIfSyncAborted(signal)
  const toUpload = [...localById.values()].filter(
    (point) =>
      !foreignOwnedIds.has(point.id) &&
      !outboundDeletionIds.has(point.id) &&
      (dirtyIds.has(point.id) || !serverIds.has(point.id)) &&
      (isFromScratch || !deletedThisWindow.has(point.id))
  )
  for (const point of toUpload) ownedIds.add(point.id)
  const uploadedIds = new Set<string>()
  const failures = await pooled(
    toUpload,
    async (point) => {
      const saved = await uploadSavedPoint(point, signal, accountId)
      throwIfSyncAborted(signal)
      throwIfSavedPointAccountChanged(accountId)
      localById.set(saved.id, saved)
      serverIds.add(saved.id)
      dirtyIds.delete(saved.id)
      uploadedIds.add(saved.id)
    },
    signal
  )
  throwIfSyncAborted(signal)

  const cutoff = cursor - TOMBSTONE_MEMORY_MS
  const appliedSavedPointTombstones: Record<string, number> = {}
  for (const [id, deletedAt] of applied) {
    if (deletedAt >= cutoff) appliedSavedPointTombstones[id] = deletedAt
  }
  await updateSavedPointSyncState(accountId, (latest) => {
    const current = latest ?? emptySavedPointSyncState()
    const initialOutboundIds = new Set(state?.outboundIds ?? [])
    const initialDeletionIds = new Set(state?.outboundDeletionIds ?? [])
    const outboundIds = new Set(
      (current.outboundIds ?? []).filter((id) => !initialOutboundIds.has(id))
    )
    const outboundDeletionIdsToSave = new Set(
      (current.outboundDeletionIds ?? []).filter(
        (id) => !initialDeletionIds.has(id)
      )
    )
    for (const id of dirtyIds) outboundIds.add(id)
    for (const id of outboundDeletionIds) outboundDeletionIdsToSave.add(id)
    for (const id of uploadedIds) outboundIds.delete(id)

    const mergedTombstones: Record<string, number> = {
      ...current.appliedTombstones,
    }
    for (const [id, deletedAt] of Object.entries(appliedSavedPointTombstones)) {
      if ((mergedTombstones[id] ?? 0) < deletedAt) {
        mergedTombstones[id] = deletedAt
      }
    }
    return {
      cursor: Math.max(current.cursor, cursor),
      lastSyncAt: Math.max(current.lastSyncAt, state?.lastSyncAt ?? 0),
      serverPointIds: [...serverIds],
      ownedIds: [...new Set([...current.ownedIds, ...ownedIds])],
      appliedTombstones: mergedTombstones,
      outboundIds: [...outboundIds],
      outboundDeletionIds: [...outboundDeletionIdsToSave],
    }
  })
  throwIfSyncAborted(signal)
  throwIfSavedPointAccountChanged(accountId)
  if (remoteUpdates.length > 0 || deletedIds.length > 0) {
    onChanged?.({
      downloadedCount: 0,
      updatedCount: 0,
      deletedIds: [],
      savedPoints: remoteUpdates,
      deletedSavedPointIds: deletedIds,
    })
  }
  if (deletionFailures > 0 || failures > 0) {
    throw new Error("Some saved point changes couldn't be synced")
  }
}

const TOMBSTONE_MEMORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Runs `fn` over `items` with a bounded number in flight.
 *
 * Returns the number that failed rather than swallowing it. The caller needs
 * that: advancing the manifest cursor past an activity that failed to download
 * would skip it permanently, turning one transient error into missing data.
 */
async function pooled<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<number> {
  throwIfSyncAborted(signal)
  let next = 0
  let failed = 0
  const workers = Array.from(
    { length: Math.min(SYNC_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        throwIfSyncAborted(signal)
        const item = items[next++]
        try {
          await fn(item)
        } catch (err) {
          if (signal?.aborted || isSyncCancellationError(err)) {
            throwIfSyncAborted(signal)
            throw err
          }
          failed++
          console.warn("[sync] item failed:", err)
        }
      }
    }
  )
  await Promise.all(workers)
  throwIfSyncAborted(signal)
  return failed
}

async function fetchSavedPointsManifest(
  since: number,
  signal?: AbortSignal
): Promise<{
  serverPoints: SavedPoint[]
  deletions: SavedPointTombstone[]
  cursor: number
}> {
  const serverPoints: SavedPoint[] = []
  const deletions: SavedPointTombstone[] = []
  let cursor = since
  for (;;) {
    throwIfSyncAborted(signal)
    const res = await apiRaw(
      "GET",
      `/api/saved-points/manifest?since=${encodeURIComponent(String(cursor))}`,
      { signal }
    )
    const page = (await res.json()) as SavedPointManifestPage
    throwIfSyncAborted(signal)
    serverPoints.push(...page.savedPoints)
    deletions.push(...page.deletions)
    cursor = page.cursor
    if (!page.hasMore) break
  }
  return { serverPoints, deletions, cursor }
}

async function uploadSavedPoint(
  point: SavedPoint,
  signal?: AbortSignal,
  accountId?: string
): Promise<SavedPoint> {
  throwIfSyncAborted(signal)
  if (accountId) throwIfSavedPointAccountChanged(accountId)
  const input: SavedPointUpsertInput = {
    id: point.id,
    lng: point.lng,
    lat: point.lat,
    name: point.name,
    description: point.description,
    color: point.color,
    isPublic: point.isPublic,
  }
  const res = await apiRaw("PUT", `/api/saved-points/${point.id}`, {
    body: input,
    signal,
  })
  const { savedPoint } = (await res.json()) as SavedPointUpsertResponse
  throwIfSyncAborted(signal)
  if (accountId) throwIfSavedPointAccountChanged(accountId)
  await saveSavedPoint(savedPoint)
  throwIfSyncAborted(signal)
  if (accountId) throwIfSavedPointAccountChanged(accountId)
  return savedPoint
}

async function deleteSavedPointOnServer(
  id: string,
  signal?: AbortSignal,
  accountId?: string
): Promise<number> {
  throwIfSyncAborted(signal)
  if (accountId) throwIfSavedPointAccountChanged(accountId)
  const res = await apiRaw("DELETE", `/api/saved-points/${id}`, { signal })
  const { deletedAt } = (await res.json()) as SavedPointDeleteResponse
  throwIfSyncAborted(signal)
  if (accountId) throwIfSavedPointAccountChanged(accountId)
  return deletedAt
}

/**
 * Queue a local point create/edit for sync and try it immediately. A failed
 * request deliberately leaves its id outbound so ordinary sync triggers retry.
 */
export async function pushSavedPointUpdate(
  point: SavedPoint
): Promise<SavedPoint> {
  const auth = getAuthState()
  const accountId = auth.status === "signedIn" ? auth.user.id : undefined
  return withSavedPointSyncLock(async () => {
    const queued = await updateSavedPointSyncState(accountId, (current) => {
      const state = current ?? emptySavedPointSyncState()
      const outbound = new Set(state.outboundIds)
      outbound.add(point.id)
      const outboundDeletions = new Set(state.outboundDeletionIds)
      outboundDeletions.delete(point.id)
      return {
        ...state,
        ownedIds: [...new Set([...state.ownedIds, point.id])],
        outboundIds: [...outbound],
        outboundDeletionIds: [...outboundDeletions],
      }
    })
    if (!queued || !canSync() || !accountId) return point
    try {
      const saved = await uploadSavedPoint(point, undefined, accountId)
      await updateSavedPointSyncState(accountId, (current) => {
        const state = current ?? emptySavedPointSyncState()
        const outbound = new Set(state.outboundIds)
        outbound.delete(point.id)
        return { ...state, outboundIds: [...outbound] }
      })
      requestSync("saved-point-update")
      return saved
    } catch (err) {
      if (!isSyncCancellationError(err)) {
        console.warn("[sync] failed to propagate saved-point update:", err)
      }
      return point
    }
  })
}

/** Queue a local deletion and try to propagate its tombstone immediately. */
export async function pushSavedPointDeletion(id: string): Promise<void> {
  const auth = getAuthState()
  const accountId = auth.status === "signedIn" ? auth.user.id : undefined
  await withSavedPointSyncLock(async () => {
    const queued = await updateSavedPointSyncState(accountId, (current) => {
      const state = current ?? emptySavedPointSyncState()
      const outbound = new Set(state.outboundIds)
      const outboundDeletions = new Set(state.outboundDeletionIds)
      outbound.delete(id)
      outboundDeletions.add(id)
      return {
        ...state,
        ownedIds: [...new Set([...state.ownedIds, id])],
        outboundIds: [...outbound],
        outboundDeletionIds: [...outboundDeletions],
      }
    })
    if (!queued || !canSync() || !accountId) return
    try {
      const deletedAt = await deleteSavedPointOnServer(id, undefined, accountId)
      await updateSavedPointSyncState(accountId, (current) => {
        const state = current ?? emptySavedPointSyncState()
        const outboundDeletions = new Set(state.outboundDeletionIds)
        outboundDeletions.delete(id)
        return {
          ...state,
          outboundDeletionIds: [...outboundDeletions],
          appliedTombstones: {
            ...state.appliedTombstones,
            [id]: deletedAt,
          },
        }
      })
      requestSync("saved-point-deletion")
    } catch (err) {
      if (!isSyncCancellationError(err)) {
        console.warn("[sync] failed to propagate saved-point deletion:", err)
      }
    }
  })
}

/** Compatibility facade for callers that already committed a local update. */
export async function pushActivityUpdate(
  activity: ParsedActivity
): Promise<void> {
  const repository = repositoryForCurrentAccount()
  if (!isServerEnabled || !repository || !activity.contentHash) return
  const item = createActivityUploadOutboxItem(
    activity,
    createUuid(),
    activityLibrary.getSnapshot().revision
  )
  if (!item) return
  await repository.enqueueOutbox(item)
  requestSync("activity-update")
}

/**
 * Propagate a local delete to the server. Called by the `delete-activity` action;
 * a no-op when signed out, and never fatal — the activity is already gone locally.
 */
export async function pushActivityDeletion(
  activity: ParsedActivity
): Promise<void> {
  const repository = repositoryForCurrentAccount()
  if (!isServerEnabled || !repository || !activity.contentHash) return
  const item = createActivityDeleteOutboxItem(
    activity,
    createUuid(),
    activityLibrary.getSnapshot().revision
  )
  if (!item) return
  await repository.enqueueOutbox(item)
  requestSync("activity-deletion")
}

/**
 * Record that this device dropped an activity locally but left the server copy
 * alone, so the next sync does not download it straight back.
 */
export async function ignoreActivityLocally(
  activity: ParsedActivity
): Promise<void> {
  if (!canSync() || !activity.contentHash) return
  await addIgnoredHashes([activity.contentHash])
}

/**
 * Mark hashes as deliberately unsynced on this device.
 *
 * Creates the sync state when there is none: a device that has never completed
 * a sync still has to record the decision, or the very first sync would undo it.
 */
async function addIgnoredHashes(hashes: string[]): Promise<void> {
  const repository = repositoryForCurrentAccount()
  if (hashes.length === 0 || !repository) return
  const state = await loadActivitySyncState()
  const ignored = new Set(state.ignoredHashes ?? [])
  const before = ignored.size
  for (const hash of hashes) ignored.add(hash)
  if (ignored.size === before) return
  await repository.saveState({
    ...state,
    ignoredHashes: [...ignored],
  })
}

/**
 * Wipe every activity from the server while leaving local libraries intact.
 *
 * No tombstones are written, which is what makes this "server only": other
 * devices never learn of it, so they keep their activities. They also keep their
 * cached `serverHashes`, so they believe those activities are still stored and do
 * not re-upload them — sync simply goes quiet for everything that existed at
 * this moment. `syncState` here is left untouched for exactly that reason.
 */
export async function purgeServerActivities(): Promise<number> {
  const res = await apiRaw("DELETE", "/api/activities")
  const body = (await res.json()) as { deleted: number }

  // Record every activity currently held here as unsynced. Relying on the cached
  // `serverHashes` to suppress a re-upload would be an accident waiting to
  // happen: the moment the cursor resets that cache is rebuilt from an empty
  // server and this device would helpfully upload everything straight back.
  await addIgnoredHashes(
    mapStore.activities
      .map((t) => t.contentHash)
      .filter((h): h is string => Boolean(h))
  )

  requestSync("after-purge")
  return body.deleted
}
