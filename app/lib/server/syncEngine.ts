/**
 * Track synchronisation.
 *
 * Tracks are content-addressed and immutable, so there is nothing to merge:
 * a hash the server lacks is uploaded, a hash this device lacks is downloaded,
 * and a tombstone deletes locally. That is the whole conflict model.
 *
 * Every step is individually resumable — a failed track is simply retried on
 * the next run, and the manifest cursor only advances after a clean page.
 */

import { useSyncExternalStore } from "react"
import type { ManifestPage, TrackMeta, TrackUploadPayload } from "~shared/api"
import { MAX_TRACK_BYTES, SYNC_CONCURRENCY } from "~shared/constants"
import type { ParsedTrack } from "~/types/tracks"
import {
  deleteTrack as deleteTrackFromIdb,
  loadSyncState,
  saveSyncState,
  saveTracks,
} from "~/lib/storage"
import { ingestTracks, mapStore } from "~/lib/mapStore"
import { backfillContentHashes } from "~/lib/trackHash"
import { apiRaw, apiSend, ApiRequestError, friendlyMessage } from "./apiClient"
import { canSync } from "./authStore"

// ─── Status, published to the drawer ──────────────────────────────────────────

export type SyncStatus =
  | { phase: "idle"; lastSyncAt: number | null }
  | { phase: "syncing"; done: number; total: number }
  | { phase: "error"; message: string; lastSyncAt: number | null }

let status: SyncStatus = { phase: "idle", lastSyncAt: null }
const listeners = new Set<() => void>()

function setStatus(next: SyncStatus) {
  status = next
  for (const listener of listeners) listener()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => status
  )
}

// ─── Change notification ──────────────────────────────────────────────────────

export interface SyncChanges {
  /** How many tracks arrived from the server. */
  downloadedCount: number
  /** Local ids of tracks a tombstone removed. */
  deletedIds: string[]
}

let onChanged: ((changes: SyncChanges) => void) | null = null

/**
 * Registered by `home.tsx`. Sync mutates `mapStore` directly, but rebuilding
 * the fog after a remote delete and dropping deleted tracks out of the
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
 * user is signed out or not allowlisted, and coalesces concurrent requests.
 */
export function requestSync(reason: string): void {
  if (!canSync()) return
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
 * Without this, sync only ran at sign-in and after an import, so a track added
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
    // Tracks imported before sync existed have no hash yet.
    const backfilled = await backfillContentHashes(mapStore.tracks)
    if (backfilled.length > 0) await saveTracks(backfilled)

    const state = await loadSyncState()
    const since = state?.cursor ?? 0
    const { serverTracks, deletions, cursor } = await fetchManifest(since)

    const localByHash = new Map<string, ParsedTrack>()
    for (const track of mapStore.tracks) {
      if (track.contentHash) localByHash.set(track.contentHash, track)
    }

    // Accumulated across syncs — this window only describes what changed since
    // `since`, so the previously-known set has to carry forward.
    const serverHashes = new Set(since === 0 ? [] : (state?.serverHashes ?? []))
    for (const t of serverTracks) serverHashes.add(t.contentHash)
    const deletedHashes = new Set(deletions)
    for (const hash of deletedHashes) serverHashes.delete(hash)

    // Tracks this device deleted locally while choosing to leave the server
    // copy alone. Without this they would be downloaded straight back.
    const ignoredHashes = new Set(state?.ignoredHashes ?? [])

    const toUpload = [...localByHash.values()].filter(
      (t) =>
        t.contentHash &&
        !serverHashes.has(t.contentHash) &&
        !deletedHashes.has(t.contentHash) &&
        // Deliberately unsynced (a server purge, or a local-only delete that
        // was later re-imported). Never push these back up.
        !ignoredHashes.has(t.contentHash)
    )
    const toDownload = serverTracks.filter(
      (t) =>
        !localByHash.has(t.contentHash) && !ignoredHashes.has(t.contentHash)
    )
    const toDelete = [...deletedHashes].filter((h) => localByHash.has(h))

    const total = toUpload.length + toDownload.length + toDelete.length
    if (total === 0) {
      await finish(cursor, serverHashes, ignoredHashes)
      return
    }

    let done = 0
    const step = () => setStatus({ phase: "syncing", done: ++done, total })
    setStatus({ phase: "syncing", done: 0, total })

    // Deletions first — cheap, and it shrinks what we might re-upload.
    const deletedIds: string[] = []
    for (const hash of toDelete) {
      const track = localByHash.get(hash)
      if (track) {
        await removeLocalTrack(track)
        deletedIds.push(track.id)
      }
      step()
    }

    const uploadFailures = await pooled(toUpload, async (track) => {
      await uploadTrack(track)
      // Only on success: a failed upload must be retried next run.
      if (track.contentHash) serverHashes.add(track.contentHash)
      step()
    })

    const downloaded: ParsedTrack[] = []
    const downloadFailures = await pooled(toDownload, async (meta) => {
      const track = await downloadTrack(meta)
      if (track) downloaded.push(track)
      step()
    })
    // One ingest for the whole batch: a single worker post and a single
    // unique-distance pass rather than one per track.
    if (downloaded.length > 0) await ingestTracks(downloaded)

    if (downloaded.length > 0 || deletedIds.length > 0) {
      onChanged?.({ downloadedCount: downloaded.length, deletedIds })
    }

    if (downloadFailures > 0) {
      // Hold the cursor where it was. Advancing past a track we failed to
      // fetch would skip it forever — the window never covers it again.
      console.warn(`[sync] ${downloadFailures} download(s) failed; cursor held`)
      await finish(since, serverHashes, ignoredHashes)
      setStatus({
        phase: "error",
        message: "Some tracks couldn't be downloaded",
        lastSyncAt,
      })
      return
    }

    await finish(cursor, serverHashes, ignoredHashes)
    if (uploadFailures > 0) {
      setStatus({
        phase: "error",
        message: "Some tracks couldn't be uploaded",
        lastSyncAt: Date.now(),
      })
    }
  } catch (err) {
    console.warn("[sync] failed:", err)
    setStatus({ phase: "error", message: friendlyMessage(err), lastSyncAt })
  }
}

async function finish(
  cursor: number,
  serverHashes: Set<string>,
  ignoredHashes: Set<string>
): Promise<void> {
  const lastSyncAt = Date.now()
  await saveSyncState({
    cursor,
    lastSyncAt,
    serverHashes: [...serverHashes],
    ignoredHashes: [...ignoredHashes],
  })
  setStatus({ phase: "idle", lastSyncAt })
  console.debug("[sync] done")
}

/**
 * Runs `fn` over `items` with a bounded number in flight.
 *
 * Returns the number that failed rather than swallowing it. The caller needs
 * that: advancing the manifest cursor past a track that failed to download
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
  serverTracks: TrackMeta[]
  deletions: string[]
  cursor: number
}> {
  const serverTracks: TrackMeta[] = []
  const deletions: string[] = []
  let cursor = since

  // Follow `hasMore` to the end; the server pages by (updatedAt, contentHash).
  for (;;) {
    const res = await apiRaw(
      "GET",
      `/api/tracks/manifest?since=${encodeURIComponent(String(cursor))}`
    )
    const page = (await res.json()) as ManifestPage
    serverTracks.push(...page.tracks)
    deletions.push(...page.deletions.map((d) => d.contentHash))
    cursor = page.cursor
    if (!page.hasMore) break
  }

  return { serverTracks, deletions, cursor }
}

// ─── Upload / download / delete ───────────────────────────────────────────────

async function uploadTrack(track: ParsedTrack): Promise<void> {
  const { id: _id, ...rest } = track
  const payload: TrackUploadPayload = {
    ...rest,
    // Recomputed per-library on the receiving device; uploading it would ship
    // a number that is only meaningful relative to this device's other tracks.
    stats: { ...track.stats, uniqueDistanceKm: 0 },
  }

  const body = await gzip(JSON.stringify(payload))
  if (body.size > MAX_TRACK_BYTES) {
    console.warn("[sync] track too large to upload:", track.name, body.size)
    return
  }

  try {
    await apiSend("PUT", `/api/tracks/${track.contentHash}`, {
      rawBody: body,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
    })
  } catch (err) {
    // Another device won the race and stored the identical bytes first.
    if (err instanceof ApiRequestError && err.status === 409) return
    throw err
  }
}

async function downloadTrack(meta: TrackMeta): Promise<ParsedTrack | null> {
  const res = await apiRaw("GET", `/api/tracks/${meta.contentHash}`)
  const payload = (await res.json()) as TrackUploadPayload
  return {
    ...payload,
    // Ids are per-device; the content hash is the shared identity.
    id: crypto.randomUUID(),
    contentHash: meta.contentHash,
  }
}

async function removeLocalTrack(track: ParsedTrack): Promise<void> {
  mapStore.tracks = mapStore.tracks.filter((t) => t.id !== track.id)
  await deleteTrackFromIdb(track.id)
}

/**
 * Propagate a local delete to the server. Called by the `delete-track` action;
 * a no-op when signed out, and never fatal — the track is already gone locally.
 */
export async function pushTrackDeletion(track: ParsedTrack): Promise<void> {
  if (!canSync() || !track.contentHash) return
  try {
    await apiSend("DELETE", `/api/tracks/${track.contentHash}`)
  } catch (err) {
    console.warn("[sync] failed to propagate deletion:", err)
  }
}

/** Propagate a clear-all. Deletes every synced track the server still holds. */
export async function pushClearAll(tracks: ParsedTrack[]): Promise<void> {
  if (!canSync()) return
  await pooled(
    tracks.filter((t) => t.contentHash),
    (track) => pushTrackDeletion(track)
  )
}

/**
 * Record that this device dropped a track locally but left the server copy
 * alone, so the next sync does not download it straight back.
 */
export async function ignoreTrackLocally(track: ParsedTrack): Promise<void> {
  if (!canSync() || !track.contentHash) return
  await addIgnoredHashes([track.contentHash])
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
  const before = ignored.size
  for (const hash of hashes) ignored.add(hash)
  if (ignored.size === before) return
  await saveSyncState({ ...state, ignoredHashes: [...ignored] })
}

/**
 * Wipe every track from the server while leaving local libraries intact.
 *
 * No tombstones are written, which is what makes this "server only": other
 * devices never learn of it, so they keep their tracks. They also keep their
 * cached `serverHashes`, so they believe those tracks are still stored and do
 * not re-upload them — sync simply goes quiet for everything that existed at
 * this moment. `syncState` here is left untouched for exactly that reason.
 */
export async function purgeServerTracks(): Promise<number> {
  const res = await apiRaw("DELETE", "/api/tracks")
  const body = (await res.json()) as { deleted: number }

  // Record every track currently held here as unsynced. Relying on the cached
  // `serverHashes` to suppress a re-upload would be an accident waiting to
  // happen: the moment the cursor resets that cache is rebuilt from an empty
  // server and this device would helpfully upload everything straight back.
  await addIgnoredHashes(
    mapStore.tracks
      .map((t) => t.contentHash)
      .filter((h): h is string => Boolean(h))
  )

  requestSync("after-purge")
  return body.deleted
}
