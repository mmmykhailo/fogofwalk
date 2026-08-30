import type { ParsedActivity, FogMode } from "~/types/activities"
import type { ServerUser, UserCapabilities } from "~shared/api"
import type { PhotoEntry } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"

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
  activityIds: string[]
  fogMode: FogMode
  fogData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
}

interface PrefEntry {
  key: string
  value: unknown
}

// ─── DB singleton ──────────────────────────────────────────────────────────────

const DB_NAME = "fogofwalk"
const DB_VERSION = 3

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
        const tx = (e.target as IDBOpenDBRequest).transaction!
        if (!db.objectStoreNames.contains("activities")) {
          db.createObjectStore("activities", { keyPath: "id" })
        }

        // v1 called imported activities "tracks". Copy each record inside the
        // versionchange transaction, then remove the legacy store only after
        // its cursor is exhausted so no existing activity can be stranded.
        if (e.oldVersion < 2 && db.objectStoreNames.contains("tracks")) {
          const legacyStore = tx.objectStore("tracks")
          const activitiesStore = tx.objectStore("activities")
          const cursorRequest = legacyStore.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor) {
              activitiesStore.put(cursor.value)
              cursor.continue()
              return
            }
            db.deleteObjectStore("tracks")
          }
        }
        if (!db.objectStoreNames.contains("photos")) {
          db.createObjectStore("photos", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("saved-points")) {
          db.createObjectStore("saved-points", { keyPath: "id" })
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

// ─── Activities ───────────────────────────────────────────────────────────────────

/** Upsert activities into storage. Uses put, so re-adding the same ID is idempotent. */
export async function saveActivities(
  activities: ParsedActivity[]
): Promise<void> {
  if (activities.length === 0) return
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("activities", "readwrite")
    const store = tx.objectStore("activities")
    for (const activity of activities) store.put(activity)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] saveActivities failed:", err)
  }
}

// Fields added after initial release; absent in older IDB records.
type StoredActivity = Omit<
  ParsedActivity,
  "startedAtMs" | "stats" | "isPublic"
> & {
  startedAtMs?: number | null
  isPublic?: boolean
  stats: Omit<ParsedActivity["stats"], "uniqueDistanceKm"> & {
    uniqueDistanceKm?: number
  }
}

/** Load all persisted activities. Returns [] on any error. */
export async function loadActivities(): Promise<ParsedActivity[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction("activities", "readonly")
    const store = tx.objectStore("activities")
    const activities = await promisifyRequest<StoredActivity[]>(store.getAll())
    for (const activity of activities) {
      if (activity.startedAtMs === undefined) {
        const first = activity.pointTimestamps?.find(
          (t) => t != null && isFinite(t)
        )
        activity.startedAtMs = first ?? null
      }
      if (activity.isPublic === undefined) {
        activity.isPublic = false
      }
      if (activity.stats.uniqueDistanceKm === undefined) {
        activity.stats.uniqueDistanceKm = activity.stats.distanceKm
      }
    }
    return activities as ParsedActivity[]
  } catch (err) {
    console.warn("[storage] loadActivities failed:", err)
    return []
  }
}

/** Delete a single activity by id from storage. */
export async function deleteActivity(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("activities", "readwrite")
    tx.objectStore("activities").delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] deleteActivity failed:", err)
  }
}

/** Delete all activities from storage. */
export async function clearActivities(): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("activities", "readwrite")
    tx.objectStore("activities").clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] clearActivities failed:", err)
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

// ─── Saved points ─────────────────────────────────────────────────────────────

/** Upsert a single saved point. */
export async function saveSavedPoint(point: SavedPoint): Promise<void> {
  return saveSavedPoints([point])
}

/** Upsert saved points into storage. */
export async function saveSavedPoints(points: SavedPoint[]): Promise<void> {
  if (points.length === 0) return
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("saved-points", "readwrite")
    const store = tx.objectStore("saved-points")
    for (const point of points) store.put(point)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] saveSavedPoints failed:", err)
  }
}

/** Load all saved points. Returns [] on any error. */
export async function loadSavedPoints(): Promise<SavedPoint[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction("saved-points", "readonly")
    return await promisifyRequest<SavedPoint[]>(
      tx.objectStore("saved-points").getAll()
    )
  } catch (err) {
    console.warn("[storage] loadSavedPoints failed:", err)
    return []
  }
}

/** Delete one saved point from local storage. */
export async function deleteSavedPoint(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("saved-points", "readwrite")
    tx.objectStore("saved-points").delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] deleteSavedPoint failed:", err)
  }
}

/** Delete every locally persisted saved point. */
export async function clearSavedPoints(): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction("saved-points", "readwrite")
    tx.objectStore("saved-points").clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] clearSavedPoints failed:", err)
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
  const cache = await prefGet<FogCache & { trackIds?: string[] }>("fogCache")
  if (!cache) return null
  if (!cache.activityIds && cache.trackIds) {
    return { ...cache, activityIds: cache.trackIds }
  }
  return cache
}

export async function clearFogCache(): Promise<void> {
  return prefDelete("fogCache")
}

/**
 * Returns true if the stored fog is still valid for the current activities + mode.
 * Pure function — no IDB access.
 */
export function isFogCacheValid(
  cache: FogCache,
  currentActivityIds: string[],
  currentFogMode: FogMode
): boolean {
  if (cache.fogMode !== currentFogMode) return false
  if (cache.activityIds.length !== currentActivityIds.length) return false
  const cacheSet = new Set(cache.activityIds)
  return currentActivityIds.every((id) => cacheSet.has(id))
}

// ─── Sync session ─────────────────────────────────────────────────────────────

/**
 * The signed-in session, persisted so the drawer can render the user's name on
 * first paint without waiting for `/api/me`. The stored user is a cache — the
 * server's answer always wins once it arrives.
 */
export interface StoredSession {
  token: string
  expiresAt: number
  user: ServerUser
  capabilities: UserCapabilities
}

export async function saveSession(session: StoredSession): Promise<void> {
  return prefSet("session", session)
}

export async function loadSession(): Promise<StoredSession | null> {
  return prefGet<StoredSession>("session")
}

export async function clearSession(): Promise<void> {
  return prefDelete("session")
}

// ─── Sync state ───────────────────────────────────────────────────────────────

/** Where the last successful manifest walk got to. */
export interface SyncState {
  /** Feed back as `?since=` on the next manifest call. */
  cursor: number
  lastSyncAt: number
  /**
   * Every content hash known to exist on the server.
   *
   * Required because the manifest is incremental: a page fetched with a
   * non-zero cursor only lists *recent* activities, so without this the older ones
   * would look absent and be re-uploaded on every single sync. Rebuilt from
   * scratch whenever the cursor resets to 0.
   */
  serverHashes: string[]
  /**
   * Activities this device deleted locally while deliberately leaving the server
   * copy in place. Without this the next sync would download them straight
   * back, and "delete" would look broken.
   */
  ignoredHashes?: string[]
  /**
   * Tombstones already acted on, hash → its `deletedAt`.
   *
   * The manifest cursor is an inclusive lower bound, so the newest tombstones
   * come back on the next sync. Without this the same deletion is applied
   * twice, which silently re-deletes a file the user just re-imported.
   */
  appliedTombstones?: Record<string, number>
  /** Independent incremental-manifest cursor for saved points. */
  savedPointsCursor?: number
  /** Known remote saved-point ids; retained across incremental windows. */
  serverSavedPointIds?: string[]
  /** Saved-point tombstones already applied on this device, id → deletedAt. */
  appliedSavedPointTombstones?: Record<string, number>
  /** Local creates/edits awaiting a successful saved-point upsert. */
  outboundSavedPointIds?: string[]
  /** Local deletions awaiting a successful saved-point tombstone. */
  outboundSavedPointDeletionIds?: string[]
}

export async function saveSyncState(state: SyncState): Promise<void> {
  return prefSet("syncState", state)
}

export async function loadSyncState(): Promise<SyncState | null> {
  return prefGet<SyncState>("syncState")
}

export async function clearSyncState(): Promise<void> {
  return prefDelete("syncState")
}

// ─── Clear all ────────────────────────────────────────────────────────────────

/**
 * Wipe all persisted data (activities, photos, IDB prefs). Used by "clear-all".
 *
 * The session is deliberately kept: clearing the map is not signing out. The
 * sync cursor *is* dropped, so the next sync re-walks the manifest from zero
 * rather than believing it is already up to date with activities that are gone.
 */
export async function clearAll(): Promise<void> {
  await Promise.all([
    clearActivities(),
    clearPhotos(),
    clearSavedPoints(),
    prefDelete("fogMode"),
    prefDelete("fogCache"),
    prefDelete("syncState"),
  ])
}
