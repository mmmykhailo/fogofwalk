import type { ParsedTrack, FogMode } from "~/types/tracks"
import type { PhotoEntry } from "~/types/photos"

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape stored in the "photos" store — objectUrl is never persisted. */
interface StoredPhoto {
  id: string
  file: File
  takenAtMs: number
  lng: number
  lat: number
}

export interface FogCache {
  trackIds: string[]
  fogMode: FogMode
  fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
}

interface PrefEntry {
  key: string
  value: unknown
}

// ─── DB singleton ──────────────────────────────────────────────────────────────

const DB_NAME = "fogofwalk"
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null

function getDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("photos")) {
          db.createObjectStore("photos", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("prefs")) {
          db.createObjectStore("prefs", { keyPath: "key" })
        }
      }

      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        console.warn("[storage] IndexedDB open failed:", req.error)
        resolve(null)
      }
    } catch (err) {
      console.warn("[storage] IndexedDB unavailable:", err)
      resolve(null)
    }
  })
  return dbPromise
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

/** Upsert tracks into storage. Uses put, so re-adding the same ID is idempotent. */
export async function saveTracks(tracks: ParsedTrack[]): Promise<void> {
  if (tracks.length === 0) return
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("tracks", "readwrite")
    const store = tx.objectStore("tracks")
    for (const track of tracks) store.put(track)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] saveTracks failed:", err)
  }
}

// Fields added after initial release; absent in older IDB records.
type StoredTrack = Omit<ParsedTrack, "startedAtMs" | "stats"> & {
  startedAtMs?: number | null
  stats: Omit<ParsedTrack["stats"], "uniqueDistanceKm"> & { uniqueDistanceKm?: number }
}

/** Load all persisted tracks. Returns [] on any error. */
export async function loadTracks(): Promise<ParsedTrack[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction("tracks", "readonly")
    const store = tx.objectStore("tracks")
    const tracks = await promisifyRequest<StoredTrack[]>(store.getAll())
    for (const track of tracks) {
      if (track.startedAtMs === undefined) {
        const first = track.pointTimestamps?.find(
          (t) => t != null && isFinite(t)
        )
        track.startedAtMs = first ?? null
      }
      if (track.stats.uniqueDistanceKm === undefined) {
        track.stats.uniqueDistanceKm = track.stats.distanceKm
      }
    }
    return tracks as ParsedTrack[]
  } catch (err) {
    console.warn("[storage] loadTracks failed:", err)
    return []
  }
}

/** Delete a single track by id from storage. */
export async function deleteTrack(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("tracks", "readwrite")
    tx.objectStore("tracks").delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] deleteTrack failed:", err)
  }
}

/** Delete all tracks from storage. */
export async function clearTracks(): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("tracks", "readwrite")
    tx.objectStore("tracks").clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] clearTracks failed:", err)
  }
}

// ─── Photos ───────────────────────────────────────────────────────────────────

/**
 * Persist photos. Strips objectUrl before storing. Skips remaining photos
 * in the batch on QuotaExceededError (they still live in React state).
 */
export async function savePhotos(photos: PhotoEntry[]): Promise<void> {
  if (photos.length === 0) return
  const db = await getDb()
  if (!db) return
  let saved = 0
  for (const photo of photos) {
    try {
      const stored: StoredPhoto = {
        id: photo.id,
        file: photo.file,
        takenAtMs: photo.takenAtMs,
        lng: photo.lng,
        lat: photo.lat,
      }
      const tx = db.transaction("photos", "readwrite")
      tx.objectStore("photos").put(stored)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      saved++
    } catch (err) {
      const isQuota =
        err instanceof DOMException && err.name === "QuotaExceededError"
      if (isQuota) {
        console.warn(
          `[storage] quota exceeded — saved ${saved} of ${photos.length} photos`
        )
        return
      }
      console.warn("[storage] savePhotos failed for photo", photo.id, err)
    }
  }
}

/**
 * Load all persisted photos, recreating objectUrl for each File.
 * Returns [] on any error.
 */
export async function loadPhotos(): Promise<PhotoEntry[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction("photos", "readonly")
    const stored = await promisifyRequest<StoredPhoto[]>(
      tx.objectStore("photos").getAll()
    )
    return stored.map((s) => ({
      id: s.id,
      file: s.file,
      takenAtMs: s.takenAtMs,
      lng: s.lng,
      lat: s.lat,
      objectUrl: URL.createObjectURL(s.file),
    }))
  } catch (err) {
    console.warn("[storage] loadPhotos failed:", err)
    return []
  }
}

/** Delete all photos from storage. */
export async function clearPhotos(): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("photos", "readwrite")
    tx.objectStore("photos").clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] clearPhotos failed:", err)
  }
}

// ─── Prefs helpers ─────────────────────────────────────────────────────────────

async function prefSet(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const entry: PrefEntry = { key, value }
    const tx = db.transaction("prefs", "readwrite")
    tx.objectStore("prefs").put(entry)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn(`[storage] prefSet(${key}) failed:`, err)
  }
}

async function prefGet<T>(key: string): Promise<T | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const tx = db.transaction("prefs", "readonly")
    const entry = await promisifyRequest<PrefEntry | undefined>(
      tx.objectStore("prefs").get(key)
    )
    return entry ? (entry.value as T) : null
  } catch (err) {
    console.warn(`[storage] prefGet(${key}) failed:`, err)
    return null
  }
}

async function prefDelete(key: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("prefs", "readwrite")
    tx.objectStore("prefs").delete(key)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn(`[storage] prefDelete(${key}) failed:`, err)
  }
}

// ─── Fog mode ─────────────────────────────────────────────────────────────────

export async function saveFogMode(mode: FogMode): Promise<void> {
  return prefSet("fogMode", mode)
}

export async function loadFogMode(): Promise<FogMode | null> {
  return prefGet<FogMode>("fogMode")
}

// ─── Fog cache ─────────────────────────────────────────────────────────────────

export async function saveFogCache(cache: FogCache): Promise<void> {
  return prefSet("fogCache", cache)
}

export async function loadFogCache(): Promise<FogCache | null> {
  return prefGet<FogCache>("fogCache")
}

export async function clearFogCache(): Promise<void> {
  return prefDelete("fogCache")
}

/**
 * Returns true if the stored fog is still valid for the current tracks + mode.
 * Pure function — no IDB access.
 */
export function isFogCacheValid(
  cache: FogCache,
  currentTrackIds: string[],
  currentFogMode: FogMode
): boolean {
  if (cache.fogMode !== currentFogMode) return false
  if (cache.trackIds.length !== currentTrackIds.length) return false
  const cacheSet = new Set(cache.trackIds)
  return currentTrackIds.every((id) => cacheSet.has(id))
}

// ─── Clear all ────────────────────────────────────────────────────────────────

/** Wipe all persisted data (tracks, photos, IDB prefs). Used by "clear-all". */
export async function clearAll(): Promise<void> {
  await Promise.all([
    clearTracks(),
    clearPhotos(),
    prefDelete("fogMode"),
    prefDelete("fogCache"),
  ])
}
