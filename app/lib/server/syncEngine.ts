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
  ManifestPage,
  ActivityMetadataPatch,
  ActivityDeleteResponse,
  ActivityMeta,
  ActivityTombstone,
  ActivityUploadPayload,
  SavedPointDeleteResponse,
  SavedPointManifestPage,
  SavedPointTombstone,
  SavedPointUpsertInput,
  SavedPointUpsertResponse,
} from "~shared/api"
import {
  MAX_ACTIVITY_BYTES,
  SYNC_CONCURRENCY,
  SYNC_PAGE_SIZE,
} from "~shared/constants"
import type { SavedPoint } from "~shared/saved-points"
import type { ParsedActivity } from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"
import {
  activityToSummary,
  deleteActivity as deleteActivityFromIdb,
  loadSyncState,
  loadActivitySummaries,
  saveSyncState,
  saveActivities,
  updateActivityMetadata as updateActivityMetadataInStorage,
  deleteSavedPoint as deleteSavedPointFromIdb,
  loadSavedPoints,
  saveSavedPoint,
  saveSavedPoints,
} from "~/lib/storage"
import {
  hydrateFullActivities,
  applyActivityMetadata,
  ingestActivities,
  mapStore,
  setFullActivities,
} from "~/lib/mapStore"
import { backfillContentHashes } from "~/lib/activityHash"
import { createUuid } from "~/lib/uuid"
import { apiRaw, apiSend, ApiRequestError, friendlyMessage } from "./apiClient"
import { updateActivityMetadata } from "./activityMetadata"
import { canSync } from "./authStore"
import {
  acquireUploadSlot,
  fallbackBackoffMs,
  MAX_UPLOAD_RETRIES,
  penalizeUploads,
} from "./uploadGate"

// ─── Status, published to the drawer ──────────────────────────────────────────

export type SyncStatus =
  | { phase: "idle"; lastSyncAt: number | null }
  | { phase: "syncing"; done: number; total: number }
  | { phase: "error"; message: string; lastSyncAt: number | null }

let status: SyncStatus = { phase: "idle", lastSyncAt: null }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: SyncStatus) {
  status = next
  notify()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status
  )
}

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
    subscribe,
    () => isSuspended,
    () => isSuspended
  )
}

/** Pause automatic syncing until the page reloads. */
export function suspendAutoSync(reason: string): void {
  if (isSuspended) return
  isSuspended = true
  console.debug("[sync] auto-sync suspended:", reason)
  notify()
}

/** Resume. Only ever called by an explicit user action. */
export function resumeAutoSync(): void {
  if (!isSuspended) return
  isSuspended = false
  console.debug("[sync] auto-sync resumed")
  notify()
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
 * Registered by `home.tsx`. Sync mutates `mapStore` directly, but rebuilding
 * the fog after a remote delete and dropping deleted activities out of the
 * selection are React concerns that belong in the route.
 */
export function setSyncChangeHandler(
  handler: ((changes: SyncChanges) => void) | null
): void {
  onChanged = handler
}

/** Drawer subtitle for the current status. Null when there is nothing to say. */
export function describeSyncStatus(s: SyncStatus): string | null {
  if (s.phase === "syncing") return `Syncing ${s.done} of ${s.total}…`
  if (s.phase === "error") return s.message
  if (s.lastSyncAt === null) return null
  const ageMs = Date.now() - s.lastSyncAt
  if (ageMs < 60_000) return "Synced just now"
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `Synced ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Synced ${hours}h ago`
  return `Synced ${Math.floor(hours / 24)}d ago`
}

// ─── Gzip helpers ─────────────────────────────────────────────────────────────

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  return new Response(stream).blob()
}

// ─── Run loop ─────────────────────────────────────────────────────────────────

let isRunning = false
/** Set when a trigger fires mid-run: the loop repeats instead of dropping it. */
let isRerunQueued = false

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
  if (!canSync()) return
  if (isSuspended) {
    if (!options.manual) {
      console.debug("[sync] skipped while suspended:", reason)
      return
    }
    resumeAutoSync()
  }
  if (isRunning) {
    isRerunQueued = true
    return
  }
  void runSync(reason)
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

async function runSync(reason: string): Promise<void> {
  isRunning = true
  try {
    do {
      isRerunQueued = false
      await syncOnce(reason)
    } while (isRerunQueued && canSync())
  } finally {
    isRunning = false
  }
}

async function syncOnce(reason: string): Promise<void> {
  const lastSyncAt = status.phase === "syncing" ? null : status.lastSyncAt
  console.debug("[sync] start", reason)

  try {
    // Saved points have their own manifest cursor and are intentionally kept
    // outside activity upload pacing. Reconcile them before activities.
    await syncSavedPoints()

    // Activities imported before sync existed have no hash yet.
    const backfilled = await backfillContentHashes(mapStore.activities)
    if (backfilled.length > 0) await saveActivities(backfilled)

    const state = await loadSyncState()
    const dirtyActivityHashes = new Set(
      state?.outboundActivityUpdateHashes ?? []
    )
    const settledActivityUpdateHashes = new Set<string>()
    if (dirtyActivityHashes.size > 0) {
      // A library page can enqueue a metadata edit while retaining summaries
      // only. The existing upload endpoint needs the full activity, so hydrate
      // it here rather than making the route action wait for geometry.
      await hydrateFullActivities()
    }
    const since = state?.cursor ?? 0
    const { serverActivities, deletions, cursor } = await fetchManifest(since)

    const localByHash = new Map<string, ParsedActivity>()
    for (const activity of mapStore.activities) {
      if (activity.contentHash) localByHash.set(activity.contentHash, activity)
    }
    for (const hash of dirtyActivityHashes) {
      if (!localByHash.has(hash)) {
        dirtyActivityHashes.delete(hash)
        settledActivityUpdateHashes.add(hash)
      }
    }

    // Accumulated across syncs — this window only describes what changed since
    // `since`, so the previously-known set has to carry forward.
    const serverHashes = new Set(since === 0 ? [] : (state?.serverHashes ?? []))
    for (const t of serverActivities) serverHashes.add(t.contentHash)
    for (const tomb of deletions) serverHashes.delete(tomb.contentHash)

    // Activities this device deleted locally while choosing to leave the server
    // copy alone. Without this they would be downloaded straight back.
    const ignoredHashes = new Set(state?.ignoredHashes ?? [])

    /**
     * A from-scratch walk converges toward the union of local and server —
     * never toward deletion.
     *
     * With no cursor there is no prior shared state to reconcile against, so a
     * tombstone says nothing about *this* device: it describes a deletion
     * relative to a history it no longer has. `clear-all` drops syncState, so
     * every tombstone the account ever wrote replays here. Honouring them would
     * delete activities the user had just re-imported and refuse to upload them.
     *
     * Incremental walks keep the real semantics — that is where a delete on one
     * device has to reach the others.
     */
    const isFromScratch = since === 0

    const serverByHash = new Map(
      serverActivities.map((activity) => [activity.contentHash, activity])
    )
    const metadataDiffers = (
      local: ParsedActivity,
      server: ActivityMeta
    ): boolean =>
      local.name !== server.name ||
      Boolean(local.isPublic) !== server.isPublic ||
      local.activityType !== server.activityType ||
      local.startSunPhase !== server.startSunPhase

    // Unlike user-editable metadata, sun phase is derived during import. A
    // newly derived value may safely backfill an older server record even in
    // an incremental sync; never let the missing legacy value overwrite it.
    const shouldBackfillSunPhase = (
      local: ParsedActivity,
      server: ActivityMeta
    ): boolean =>
      local.startSunPhase !== undefined && server.startSunPhase === undefined

    /**
     * A tombstone must be acted on exactly once per device.
     *
     * The server's cursor is an *inclusive* lower bound (deliberately — it is
     * how a row written in the same millisecond as the read is not lost), so
     * the newest tombstones are re-served on the following sync. Without this
     * memory, re-importing a file you had just deleted gets it silently deleted
     * again and refused for upload, because the same tombstone applies twice.
     */
    const applied = new Map<string, number>(
      Object.entries(state?.appliedTombstones ?? {})
    )
    const freshTombstones = deletions.filter(
      (tomb) => applied.get(tomb.contentHash) !== tomb.deletedAt
    )
    const freshDeletedHashes = new Set(
      freshTombstones.map((tomb) => tomb.contentHash)
    )

    const toUpload = [...localByHash.values()].filter((t) => {
      if (!t.contentHash) return false
      const server = serverByHash.get(t.contentHash)
      const isMissing = !serverHashes.has(t.contentHash)
      const shouldRestoreLocalMetadata =
        server != null &&
        metadataDiffers(t, server) &&
        (isFromScratch || shouldBackfillSunPhase(t, server))
      return (
        (dirtyActivityHashes.has(t.contentHash) ||
          isMissing ||
          shouldRestoreLocalMetadata) &&
        // Suppressed only while the deletion is still being applied. Once it
        // has been, a local copy means a deliberate re-import — resurrect it.
        (isFromScratch || !freshDeletedHashes.has(t.contentHash)) &&
        // Deliberately unsynced (a server purge, or a local-only delete that
        // was later re-imported). Never push these back up.
        !ignoredHashes.has(t.contentHash)
      )
    })
    const toDownload = serverActivities.filter((server) => {
      if (ignoredHashes.has(server.contentHash)) return false
      const local = localByHash.get(server.contentHash)
      if (!local) return true
      return (
        !isFromScratch &&
        !dirtyActivityHashes.has(server.contentHash) &&
        metadataDiffers(local, server) &&
        !shouldBackfillSunPhase(local, server)
      )
    })
    const toDelete = isFromScratch
      ? []
      : [...freshDeletedHashes].filter((h) => localByHash.has(h))

    // Recorded even when not acted on, so a from-scratch walk cannot leave the
    // whole backlog primed to fire on the next incremental sync.
    for (const tomb of deletions) applied.set(tomb.contentHash, tomb.deletedAt)

    const total = toUpload.length + toDownload.length + toDelete.length
    if (total === 0) {
      await finish(
        cursor,
        serverHashes,
        ignoredHashes,
        applied,
        dirtyActivityHashes,
        settledActivityUpdateHashes
      )
      return
    }

    let done = 0
    const step = () => setStatus({ phase: "syncing", done: ++done, total })
    setStatus({ phase: "syncing", done: 0, total })

    // Deletions first — cheap, and it shrinks what we might re-upload.
    const deletedIds: string[] = []
    for (const hash of toDelete) {
      const activity = localByHash.get(hash)
      if (activity) {
        await removeLocalActivity(activity)
        deletedIds.push(activity.id)
      }
      dirtyActivityHashes.delete(hash)
      settledActivityUpdateHashes.add(hash)
      step()
    }

    const uploadFailures = await pooled(toUpload, async (activity) => {
      await uploadActivity(activity)
      // Only on success: a failed upload must be retried next run.
      if (activity.contentHash) {
        serverHashes.add(activity.contentHash)
        if (dirtyActivityHashes.delete(activity.contentHash)) {
          settledActivityUpdateHashes.add(activity.contentHash)
        }
      }
      step()
    })

    const downloaded: ParsedActivity[] = []
    const updated: ParsedActivity[] = []
    const downloadFailures = await pooled(toDownload, async (meta) => {
      const local = localByHash.get(meta.contentHash)
      const activity = await downloadActivity(meta, local?.id)
      if (activity) {
        if (local) updated.push(activity)
        else downloaded.push(activity)
      }
      step()
    })
    // One ingest for the whole batch: a single worker post and a single
    // unique-distance pass rather than one per activity.
    if (downloaded.length > 0) await ingestActivities(downloaded)

    if (updated.length > 0) {
      const byHash = new Map(
        updated.map((activity) => [activity.contentHash, activity])
      )
      setFullActivities(
        mapStore.activities.map(
          (activity) => byHash.get(activity.contentHash) ?? activity
        )
      )
      await populateUniqueDistances(mapStore.activities)
      await saveUniqueDistances(mapStore.activities)
    }

    if (downloaded.length > 0 || updated.length > 0 || deletedIds.length > 0) {
      onChanged?.({
        downloadedCount: downloaded.length,
        updatedCount: updated.length,
        deletedIds,
      })
    }

    if (downloadFailures > 0) {
      // Hold the cursor where it was. Advancing past an activity we failed to
      // fetch would skip it forever — the window never covers it again.
      console.warn(`[sync] ${downloadFailures} download(s) failed; cursor held`)
      await finish(
        since,
        serverHashes,
        ignoredHashes,
        applied,
        dirtyActivityHashes,
        settledActivityUpdateHashes
      )
      setStatus({
        phase: "error",
        message: "Some activities couldn't be downloaded",
        lastSyncAt,
      })
      return
    }

    await finish(
      cursor,
      serverHashes,
      ignoredHashes,
      applied,
      dirtyActivityHashes,
      settledActivityUpdateHashes
    )
    if (uploadFailures > 0) {
      setStatus({
        phase: "error",
        message: "Some activities couldn't be uploaded",
        lastSyncAt: Date.now(),
      })
    }
  } catch (err) {
    console.warn("[sync] failed:", err)
    setStatus({ phase: "error", message: friendlyMessage(err), lastSyncAt })
  }
}

/** Reconcile remote point changes/deletions, then upload local outbound edits. */
async function syncSavedPoints(): Promise<void> {
  const state = await loadSyncState()
  const since = state?.savedPointsCursor ?? 0
  const isFromScratch = since === 0
  const { serverPoints, deletions, cursor } =
    await fetchSavedPointsManifest(since)
  const localById = new Map(
    (await loadSavedPoints()).map((point) => [point.id, point])
  )
  const serverIds = new Set(
    isFromScratch ? [] : (state?.serverSavedPointIds ?? [])
  )
  for (const point of serverPoints) serverIds.add(point.id)
  for (const tombstone of deletions) serverIds.delete(tombstone.id)

  const applied = new Map<string, number>(
    Object.entries(state?.appliedSavedPointTombstones ?? {})
  )
  const freshTombstones = deletions.filter(
    (tombstone) => applied.get(tombstone.id) !== tombstone.deletedAt
  )
  const dirtyIds = new Set(state?.outboundSavedPointIds ?? [])
  const outboundDeletionIds = new Set(
    state?.outboundSavedPointDeletionIds ?? []
  )
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
  await saveSyncState({
    cursor: state?.cursor ?? 0,
    lastSyncAt: state?.lastSyncAt ?? 0,
    serverHashes: state?.serverHashes ?? [],
    ...state,
    savedPointsCursor: cursor,
    serverSavedPointIds: [...serverIds],
    appliedSavedPointTombstones,
    outboundSavedPointIds: [...dirtyIds],
    outboundSavedPointDeletionIds: [...outboundDeletionIds],
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

/**
 * Tombstones older than this are dropped from the applied-set. Only the newest
 * are ever re-served (the cursor is an inclusive bound), so the memory needs to
 * cover the boundary, not all history — otherwise it grows without limit.
 */
const TOMBSTONE_MEMORY_MS = 7 * 24 * 60 * 60 * 1000

async function finish(
  cursor: number,
  serverHashes: Set<string>,
  ignoredHashes: Set<string>,
  applied: Map<string, number>,
  dirtyActivityHashes: Set<string>,
  settledActivityUpdateHashes: Set<string>
): Promise<void> {
  // Saved-point synchronisation maintains an independent cursor in the same
  // preference record. Preserve it while activity sync advances its cursor.
  const existing = await loadSyncState()
  const lastSyncAt = Date.now()
  const cutoff = cursor - TOMBSTONE_MEMORY_MS
  const appliedTombstones: Record<string, number> = {}
  for (const [hash, deletedAt] of applied) {
    if (deletedAt >= cutoff) appliedTombstones[hash] = deletedAt
  }
  const outboundActivityUpdateHashes = new Set(
    existing?.outboundActivityUpdateHashes ?? []
  )
  for (const hash of settledActivityUpdateHashes) {
    outboundActivityUpdateHashes.delete(hash)
  }
  for (const hash of dirtyActivityHashes) {
    outboundActivityUpdateHashes.add(hash)
  }
  await saveSyncState({
    savedPointsCursor: existing?.savedPointsCursor,
    serverSavedPointIds: existing?.serverSavedPointIds,
    appliedSavedPointTombstones: existing?.appliedSavedPointTombstones,
    outboundSavedPointIds: existing?.outboundSavedPointIds,
    outboundSavedPointDeletionIds: existing?.outboundSavedPointDeletionIds,
    outboundActivityUpdateHashes: [...outboundActivityUpdateHashes],
    cursor,
    lastSyncAt,
    serverHashes: [...serverHashes],
    ignoredHashes: [...ignoredHashes],
    appliedTombstones,
  })
  setStatus({ phase: "idle", lastSyncAt })
  console.debug("[sync] done")
}

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

// ─── Manifest ─────────────────────────────────────────────────────────────────

async function fetchManifest(since: number): Promise<{
  serverActivities: ActivityMeta[]
  deletions: ActivityTombstone[]
  cursor: number
}> {
  const serverActivities: ActivityMeta[] = []
  const deletions: ActivityTombstone[] = []
  let cursor = since

  // Follow `hasMore` to the end; the server pages by (updatedAt, contentHash).
  for (;;) {
    const res = await apiRaw(
      "GET",
      `/api/activities/manifest?since=${encodeURIComponent(String(cursor))}`
    )
    const page = (await res.json()) as ManifestPage
    serverActivities.push(...page.activities)
    deletions.push(...page.deletions)
    cursor = page.cursor
    if (!page.hasMore) break
  }

  return { serverActivities, deletions, cursor }
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

// ─── Upload / download / delete ───────────────────────────────────────────────

async function uploadActivity(activity: ParsedActivity): Promise<void> {
  const { id: _id, ...rest } = activity
  const payload: ActivityUploadPayload = {
    ...rest,
    // Recomputed per-library on the receiving device; uploading it would ship
    // a number that is only meaningful relative to this device's other activities.
    stats: { ...activity.stats, uniqueDistanceKm: 0 },
  }

  const body = await gzip(JSON.stringify(payload))
  if (body.size > MAX_ACTIVITY_BYTES) {
    console.warn(
      "[sync] activity too large to upload:",
      activity.name,
      body.size
    )
    return
  }

  // Bounded retry rather than one shot: the only expected failure here is the
  // upload rate limit, and dropping the activity for the whole run over it means
  // waiting for a later sync trigger to try again. `acquireUploadSlot` should
  // keep us under the limit in the first place — this is the fallback for when
  // the client's view of the window and the server's disagree.
  for (let attempt = 0; ; attempt++) {
    await acquireUploadSlot()
    try {
      await apiSend("PUT", `/api/activities/${activity.contentHash}`, {
        rawBody: body,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
      })
      return
    } catch (err) {
      // Another device won the race and stored the identical bytes first.
      if (err instanceof ApiRequestError && err.status === 409) return
      if (
        err instanceof ApiRequestError &&
        err.status === 429 &&
        attempt < MAX_UPLOAD_RETRIES - 1
      ) {
        penalizeUploads(err.retryAfterMs ?? fallbackBackoffMs(attempt))
        continue
      }
      throw err
    }
  }
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
  const state = (await loadSyncState()) ?? {
    cursor: 0,
    lastSyncAt: 0,
    serverHashes: [],
  }
  const outbound = new Set(state.outboundSavedPointIds ?? [])
  outbound.add(point.id)
  const outboundDeletions = new Set(state.outboundSavedPointDeletionIds ?? [])
  outboundDeletions.delete(point.id)
  await saveSyncState({
    ...state,
    outboundSavedPointIds: [...outbound],
    outboundSavedPointDeletionIds: [...outboundDeletions],
  })
  if (!canSync()) return point
  try {
    const saved = await uploadSavedPoint(point)
    outbound.delete(point.id)
    await saveSyncState({
      ...state,
      outboundSavedPointIds: [...outbound],
      outboundSavedPointDeletionIds: [...outboundDeletions],
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
  const state = (await loadSyncState()) ?? {
    cursor: 0,
    lastSyncAt: 0,
    serverHashes: [],
  }
  const outbound = new Set(state.outboundSavedPointIds ?? [])
  const outboundDeletions = new Set(state.outboundSavedPointDeletionIds ?? [])
  outbound.delete(id)
  outboundDeletions.add(id)
  await saveSyncState({
    ...state,
    outboundSavedPointIds: [...outbound],
    outboundSavedPointDeletionIds: [...outboundDeletions],
  })
  if (!canSync()) return
  try {
    const deletedAt = await deleteSavedPointOnServer(id)
    outboundDeletions.delete(id)
    await saveSyncState({
      ...state,
      outboundSavedPointIds: [...outbound],
      outboundSavedPointDeletionIds: [...outboundDeletions],
      appliedSavedPointTombstones: {
        ...(state.appliedSavedPointTombstones ?? {}),
        [id]: deletedAt,
      },
    })
    requestSync("saved-point-deletion")
  } catch (err) {
    console.warn("[sync] failed to propagate saved-point deletion:", err)
  }
}

/** Persist metadata edits and let the existing sync loop upload them later. */
export async function queueActivityMetadataUpdates(
  activities: readonly { contentHash?: string }[]
): Promise<void> {
  const hashes = activities
    .map((activity) => activity.contentHash)
    .filter((hash): hash is string => Boolean(hash))
  if (hashes.length === 0) return

  const state = (await loadSyncState()) ?? {
    cursor: 0,
    lastSyncAt: 0,
    serverHashes: [],
  }
  const outbound = new Set(state.outboundActivityUpdateHashes ?? [])
  for (const hash of hashes) outbound.add(hash)
  await saveSyncState({
    ...state,
    outboundActivityUpdateHashes: [...outbound],
  })
  if (isRunning) isRerunQueued = true
  requestSync("activity-settings")
}

async function downloadActivity(
  meta: ActivityMeta,
  localId?: string
): Promise<ParsedActivity | null> {
  const res = await apiRaw("GET", `/api/activities/${meta.contentHash}`)
  const payload = (await res.json()) as ActivityUploadPayload
  return {
    ...payload,
    // Ids are per-device; the content hash is the shared identity.
    id: localId ?? createUuid(),
    contentHash: meta.contentHash,
    name: meta.name,
    isPublic: meta.isPublic,
    activityType: meta.activityType ?? payload.activityType,
    startSunPhase: meta.startSunPhase ?? payload.startSunPhase,
  }
}

async function removeLocalActivity(activity: ParsedActivity): Promise<void> {
  setFullActivities(mapStore.activities.filter((t) => t.id !== activity.id))
  await deleteActivityFromIdb(activity.id)
}

/**
 * Propagate a local delete to the server. Called by the `delete-activity` action;
 * a no-op when signed out, and never fatal — the activity is already gone locally.
 */
export async function pushActivityDeletion(
  activity: ParsedActivity
): Promise<void> {
  if (!canSync() || !activity.contentHash) return
  try {
    const res = await apiRaw(
      "DELETE",
      `/api/activities/${activity.contentHash}`
    )
    const { deletedAt } = (await res.json()) as ActivityDeleteResponse
    // Record our own tombstone as already applied. Without this the next sync
    // reads it back out of the manifest as news and deletes the activity again —
    // including a copy the user has deliberately re-imported since.
    await recordAppliedTombstone(activity.contentHash, deletedAt)
  } catch (err) {
    console.warn("[sync] failed to propagate deletion:", err)
  }
}

async function recordAppliedTombstone(
  contentHash: string,
  deletedAt: number
): Promise<void> {
  const state = (await loadSyncState()) ?? {
    cursor: 0,
    lastSyncAt: 0,
    serverHashes: [],
  }
  await saveSyncState({
    ...state,
    outboundActivityUpdateHashes: (
      state.outboundActivityUpdateHashes ?? []
    ).filter((hash) => hash !== contentHash),
    appliedTombstones: {
      ...(state.appliedTombstones ?? {}),
      [contentHash]: deletedAt,
    },
  })
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
  if (hashes.length === 0) return
  const state = (await loadSyncState()) ?? {
    cursor: 0,
    lastSyncAt: 0,
    serverHashes: [],
  }
  const ignored = new Set(state.ignoredHashes ?? [])
  const outboundActivityUpdates = new Set(
    state.outboundActivityUpdateHashes ?? []
  )
  const before = ignored.size
  for (const hash of hashes) ignored.add(hash)
  for (const hash of hashes) outboundActivityUpdates.delete(hash)
  if (
    ignored.size === before &&
    outboundActivityUpdates.size ===
      (state.outboundActivityUpdateHashes ?? []).length
  )
    return
  await saveSyncState({
    ...state,
    ignoredHashes: [...ignored],
    outboundActivityUpdateHashes: [...outboundActivityUpdates],
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
