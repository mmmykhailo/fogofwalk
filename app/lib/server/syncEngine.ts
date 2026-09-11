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
  loadSavedPointSyncState,
  saveSavedPointSyncState,
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
import { canSync } from "./authStore"
import { isServerEnabled } from "./config"
import { createApiSyncTransport } from "./sync/transport"
import { IndexedDbSyncRepository } from "./sync/repository"
import { ActivitySyncExecutor } from "./sync/executor"
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
  ? new IndexedDbSyncRepository()
  : null
const syncOwner = isServerEnabled ? `sync-tab:${createUuid()}` : null
const SYNC_LEASE_MS = 90_000
let nextSyncRunId = 0

async function publishOutboxStatus(
  update: SyncStatusUpdate
): Promise<ReturnType<typeof summarizeSyncOutbox> | null> {
  if (!activitySyncRepository) {
    setStatus(update)
    return null
  }
  try {
    const summary = summarizeSyncOutbox(
      await activitySyncRepository.loadOutbox()
    )
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
  if (!activitySyncRepository || !syncOwner) return false
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      "fogofwalk:sync",
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return false
        await run()
        return true
      }
    )
  }

  const acquired = await activitySyncRepository.acquireSyncLease({
    owner: syncOwner,
    now: Date.now(),
    leaseMs: SYNC_LEASE_MS,
  })
  if (!acquired) return false
  try {
    await run()
    return true
  } finally {
    await activitySyncRepository.releaseSyncLease(syncOwner)
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

async function loadActivitySyncState() {
  if (!activitySyncRepository) {
    return { cursor: 0, lastSyncAt: 0, serverHashes: [] }
  }
  return (
    (await activitySyncRepository.loadState()) ?? {
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
    // Saved points have their own manifest cursor and are intentionally kept
    // outside activity upload pacing. Reconcile them before activities.
    await syncSavedPoints()
    await initializeActivityLibrary()

    // Activities imported before sync existed have no hash yet.
    const backfillCandidates = activityLibrary
      .getSnapshot()
      .activities.map((activity) => structuredClone(activity))
    const backfilled = await backfillContentHashes(backfillCandidates)
    if (backfilled.length > 0) {
      await activityLibrary.dispatch({
        type: "applyRemote",
        operationId: createUuid(),
        changes: backfilled.map((activity) => ({
          type: "upsert" as const,
          activity,
        })),
      })
    }

    await runActivitySync(lastSyncAt, operationId, startedAt)
    return
  } catch (err) {
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
    await publishOutboxStatus({
      phase: "error",
      message: friendlyMessage(err),
      lastSyncAt,
      cursorHeld: false,
    })
  }
}

async function runActivitySync(
  lastSyncAt: number | null,
  operationId: string,
  startedAt: number
): Promise<void> {
  if (!activitySyncRepository || !syncTransport) return
  setStatus({ phase: "syncing", done: 0, total: 0 })
  const result = await new ActivitySyncExecutor({
    repository: activitySyncRepository,
    library: activityLibrary,
    transport: syncTransport,
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

  if (
    result.downloadedCount > 0 ||
    result.updatedCount > 0 ||
    result.deletedIds.length > 0
  ) {
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
    const summary = await publishOutboxStatus({
      phase: result.cursorHeld ? "partial" : "waiting",
      message,
      lastSyncAt:
        result.state.lastSyncAt > 0 ? result.state.lastSyncAt : lastSyncAt,
      cursorHeld: result.cursorHeld,
    })
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

  const summary = await publishOutboxStatus({
    phase: "idle",
    lastSyncAt: result.state.lastSyncAt,
    cursorHeld: false,
    message: null,
  })
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
async function syncSavedPoints(): Promise<void> {
  const state = await loadSavedPointSyncState()
  const since = state?.cursor ?? 0
  const isFromScratch = since === 0
  const { serverPoints, deletions, cursor } =
    await fetchSavedPointsManifest(since)
  const localById = new Map(
    (await loadSavedPoints()).map((point) => [point.id, point])
  )
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
      if (localById.has(tombstone.id)) {
        await deleteSavedPointFromIdb(tombstone.id)
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
    await saveSavedPoints(remoteUpdates)
    for (const point of remoteUpdates) localById.set(point.id, point)
  }

  const deletedThisWindow = new Set(freshTombstones.map((tomb) => tomb.id))
  const deletionFailures = await pooled(
    [...outboundDeletionIds],
    async (id) => {
      const deletedAt = await deleteSavedPointOnServer(id)
      serverIds.delete(id)
      dirtyIds.delete(id)
      outboundDeletionIds.delete(id)
      applied.set(id, deletedAt)
    }
  )
  const toUpload = [...localById.values()].filter(
    (point) =>
      !outboundDeletionIds.has(point.id) &&
      (dirtyIds.has(point.id) || !serverIds.has(point.id)) &&
      (isFromScratch || !deletedThisWindow.has(point.id))
  )
  const failures = await pooled(toUpload, async (point) => {
    const saved = await uploadSavedPoint(point)
    localById.set(saved.id, saved)
    serverIds.add(saved.id)
    dirtyIds.delete(saved.id)
  })

  const cutoff = cursor - TOMBSTONE_MEMORY_MS
  const appliedSavedPointTombstones: Record<string, number> = {}
  for (const [id, deletedAt] of applied) {
    if (deletedAt >= cutoff) appliedSavedPointTombstones[id] = deletedAt
  }
  await saveSavedPointSyncState({
    cursor,
    lastSyncAt: state?.lastSyncAt ?? 0,
    serverPointIds: [...serverIds],
    appliedTombstones: appliedSavedPointTombstones,
    outboundIds: [...dirtyIds],
    outboundDeletionIds: [...outboundDeletionIds],
  })
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
  fn: (item: T) => Promise<void>
): Promise<number> {
  let next = 0
  let failed = 0
  const workers = Array.from(
    { length: Math.min(SYNC_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++]
        try {
          await fn(item)
        } catch (err) {
          failed++
          console.warn("[sync] item failed:", err)
        }
      }
    }
  )
  await Promise.all(workers)
  return failed
}

async function fetchSavedPointsManifest(since: number): Promise<{
  serverPoints: SavedPoint[]
  deletions: SavedPointTombstone[]
  cursor: number
}> {
  const serverPoints: SavedPoint[] = []
  const deletions: SavedPointTombstone[] = []
  let cursor = since
  for (;;) {
    const res = await apiRaw(
      "GET",
      `/api/saved-points/manifest?since=${encodeURIComponent(String(cursor))}`
    )
    const page = (await res.json()) as SavedPointManifestPage
    serverPoints.push(...page.savedPoints)
    deletions.push(...page.deletions)
    cursor = page.cursor
    if (!page.hasMore) break
  }
  return { serverPoints, deletions, cursor }
}

async function uploadSavedPoint(point: SavedPoint): Promise<SavedPoint> {
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
  })
  const { savedPoint } = (await res.json()) as SavedPointUpsertResponse
  await saveSavedPoint(savedPoint)
  return savedPoint
}

async function deleteSavedPointOnServer(id: string): Promise<number> {
  const res = await apiRaw("DELETE", `/api/saved-points/${id}`)
  const { deletedAt } = (await res.json()) as SavedPointDeleteResponse
  return deletedAt
}

/**
 * Queue a local point create/edit for sync and try it immediately. A failed
 * request deliberately leaves its id outbound so ordinary sync triggers retry.
 */
export async function pushSavedPointUpdate(
  point: SavedPoint
): Promise<SavedPoint> {
  const state = (await loadSavedPointSyncState()) ?? emptySavedPointSyncState()
  const outbound = new Set(state.outboundIds)
  outbound.add(point.id)
  const outboundDeletions = new Set(state.outboundDeletionIds)
  outboundDeletions.delete(point.id)
  await saveSavedPointSyncState({
    ...state,
    outboundIds: [...outbound],
    outboundDeletionIds: [...outboundDeletions],
  })
  if (!canSync()) return point
  try {
    const saved = await uploadSavedPoint(point)
    outbound.delete(point.id)
    await saveSavedPointSyncState({
      ...state,
      outboundIds: [...outbound],
      outboundDeletionIds: [...outboundDeletions],
    })
    requestSync("saved-point-update")
    return saved
  } catch (err) {
    console.warn("[sync] failed to propagate saved-point update:", err)
    return point
  }
}

/** Queue a local deletion and try to propagate its tombstone immediately. */
export async function pushSavedPointDeletion(id: string): Promise<void> {
  const state = (await loadSavedPointSyncState()) ?? emptySavedPointSyncState()
  const outbound = new Set(state.outboundIds)
  const outboundDeletions = new Set(state.outboundDeletionIds)
  outbound.delete(id)
  outboundDeletions.add(id)
  await saveSavedPointSyncState({
    ...state,
    outboundIds: [...outbound],
    outboundDeletionIds: [...outboundDeletions],
  })
  if (!canSync()) return
  try {
    const deletedAt = await deleteSavedPointOnServer(id)
    outboundDeletions.delete(id)
    await saveSavedPointSyncState({
      ...state,
      outboundIds: [...outbound],
      outboundDeletionIds: [...outboundDeletions],
      appliedTombstones: {
        ...state.appliedTombstones,
        [id]: deletedAt,
      },
    })
    requestSync("saved-point-deletion")
  } catch (err) {
    console.warn("[sync] failed to propagate saved-point deletion:", err)
  }
}

/** Compatibility facade for callers that already committed a local update. */
export async function pushActivityUpdate(
  activity: ParsedActivity
): Promise<void> {
  if (!isServerEnabled || !activitySyncRepository || !activity.contentHash)
    return
  const item = createActivityUploadOutboxItem(
    activity,
    createUuid(),
    activityLibrary.getSnapshot().revision
  )
  if (!item) return
  await activitySyncRepository.enqueueOutbox(item)
  requestSync("activity-update")
}

/**
 * Propagate a local delete to the server. Called by the `delete-activity` action;
 * a no-op when signed out, and never fatal — the activity is already gone locally.
 */
export async function pushActivityDeletion(
  activity: ParsedActivity
): Promise<void> {
  if (!isServerEnabled || !activitySyncRepository || !activity.contentHash)
    return
  const item = createActivityDeleteOutboxItem(
    activity,
    createUuid(),
    activityLibrary.getSnapshot().revision
  )
  if (!item) return
  await activitySyncRepository.enqueueOutbox(item)
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
  if (hashes.length === 0 || !activitySyncRepository) return
  const state = await loadActivitySyncState()
  const ignored = new Set(state.ignoredHashes ?? [])
  const before = ignored.size
  for (const hash of hashes) ignored.add(hash)
  if (ignored.size === before) return
  await activitySyncRepository.saveState({
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
