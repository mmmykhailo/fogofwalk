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

    const toUpload = [...localByHash.values()].filter(
      (t) =>
        t.contentHash &&
        !serverHashes.has(t.contentHash) &&
        !deletedHashes.has(t.contentHash)
    )
    const toDownload = serverTracks.filter(
      (t) => !localByHash.has(t.contentHash)
    )
    const toDelete = [...deletedHashes].filter((h) => localByHash.has(h))

    const total = toUpload.length + toDownload.length + toDelete.length
    if (total === 0) {
      await finish(cursor, serverHashes)
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

    await pooled(toUpload, async (track) => {
      await uploadTrack(track)
      // Only on success: a failed upload must be retried next run.
      if (track.contentHash) serverHashes.add(track.contentHash)
      step()
    })

    const downloaded: ParsedTrack[] = []
    await pooled(toDownload, async (meta) => {
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

    await finish(cursor, serverHashes)
  } catch (err) {
    console.warn("[sync] failed:", err)
    setStatus({ phase: "error", message: friendlyMessage(err), lastSyncAt })
  }
}

async function finish(
  cursor: number,
  serverHashes: Set<string>
): Promise<void> {
  const lastSyncAt = Date.now()
  await saveSyncState({ cursor, lastSyncAt, serverHashes: [...serverHashes] })
  setStatus({ phase: "idle", lastSyncAt })
  console.debug("[sync] done")
}

/** Runs `fn` over `items` with a bounded number in flight. */
async function pooled<T>(
  items: T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const workers = Array.from(
    { length: Math.min(SYNC_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++]
        try {
          await fn(item)
        } catch (err) {
          // Per-track failure: the next run retries it.
          console.warn("[sync] item failed:", err)
        }
      }
    }
  )
  await Promise.all(workers)
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
