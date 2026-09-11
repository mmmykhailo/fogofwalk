import type { ParsedActivity, FogMode } from "~/types/activities"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  type FogRenderData,
} from "~/lib/fog/protocol"
import { validateFogRenderData } from "~/lib/fog/engine/validate"
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
  libraryRevision: number
  fogMode: FogMode
  algorithmVersion: typeof FOG_ALGORITHM_VERSION
  partitionSchemeVersion: typeof FOG_PARTITION_SCHEME_VERSION
  fogData: FogRenderData
}

interface PrefEntry {
  key: string
  value: unknown
}

export interface UniqueDistanceState {
  version: number
  activityIds: string[]
  /** Canonical activity-library revision represented by the marker. */
  libraryRevision: number
}

export type UniqueDistanceSaveResult =
  | { status: "saved"; libraryRevision: number }
  | {
      status: "stale"
      expectedLibraryRevision: number
      actualLibraryRevision: number | null
    }
  | { status: "unavailable"; error: Error }
  | { status: "failed"; error: unknown }

export interface SaveUniqueDistancesOptions {
  /** Only write when library-meta still has this revision. */
  libraryRevision?: number
  /** Compatibility cleanup for callers that still pass a deleted id. */
  deletedActivityId?: string
}

const UNIQUE_DISTANCE_VERSION = 2

// ─── DB singleton ──────────────────────────────────────────────────────────────

const DB_NAME = "fogofwalk"
const DB_VERSION = 6

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
        if (!db.objectStoreNames.contains("library-meta")) {
          db.createObjectStore("library-meta", { keyPath: "key" })
        }
        if (!db.objectStoreNames.contains("sync-state")) {
          db.createObjectStore("sync-state", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("sync-outbox")) {
          const outboxStore = db.createObjectStore("sync-outbox", {
            keyPath: "id",
          })
          outboxStore.createIndex("dedupeKey", "dedupeKey", { unique: true })
          outboxStore.createIndex("statusAvailableAt", [
            "status",
            "availableAt",
          ])
          outboxStore.createIndex("leaseUntil", "leaseUntil")
        } else {
          const outboxStore = tx.objectStore("sync-outbox")
          if (!outboxStore.indexNames.contains("dedupeKey")) {
            outboxStore.createIndex("dedupeKey", "dedupeKey", { unique: true })
          }
          if (outboxStore.indexNames.contains("stateAvailableAt")) {
            outboxStore.deleteIndex("stateAvailableAt")
          }
          if (!outboxStore.indexNames.contains("statusAvailableAt")) {
            outboxStore.createIndex("statusAvailableAt", [
              "status",
              "availableAt",
            ])
          }
          if (!outboxStore.indexNames.contains("leaseUntil")) {
            outboxStore.createIndex("leaseUntil", "leaseUntil")
          }
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

/**
 * Shared database handle for the activity-library repository.
 *
 * The legacy storage helpers intentionally remain available during migration,
 * but the canonical activity service must be able to report an unavailable
 * database instead of treating it as an empty library.
 */
export async function openStorageDatabase(): Promise<IDBDatabase | null> {
  return getDb()
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
export type StoredActivity = Omit<
  ParsedActivity,
  "startedAtMs" | "stats" | "isPublic"
> & {
  startedAtMs?: number | null
  isPublic?: boolean
  stats: Omit<ParsedActivity["stats"], "uniqueDistanceKm"> & {
    uniqueDistanceKm?: number
  }
}

/**
 * Apply read-time defaults for records written before the current activity
 * schema. This is intentionally non-mutating so a failed projection or a
 * caller holding the raw IDB result cannot observe a partial migration.
 */
export function migrateStoredActivity(
  activity: StoredActivity
): ParsedActivity {
  const startedAtMs =
    activity.startedAtMs === undefined
      ? (activity.pointTimestamps?.find(
          (timestamp) => timestamp != null && isFinite(timestamp)
        ) ?? null)
      : activity.startedAtMs

  return {
    ...activity,
    startedAtMs,
    isPublic: activity.isPublic ?? false,
    stats: {
      ...activity.stats,
      uniqueDistanceKm:
        activity.stats.uniqueDistanceKm ?? activity.stats.distanceKm,
    },
  } as ParsedActivity
}

/** Load all persisted activities. Returns [] on any error. */
export async function loadActivities(): Promise<ParsedActivity[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction("activities", "readonly")
    const store = tx.objectStore("activities")
    const activities = await promisifyRequest<StoredActivity[]>(store.getAll())
    return activities.map(migrateStoredActivity)
  } catch (err) {
    console.warn("[storage] loadActivities failed:", err)
    return []
  }
}

/**
 * Pure guard used immediately before writing a derived projection. A missing
 * expected revision means the caller opted out of stale-write protection.
 */
export function isUniqueDistanceRevisionCurrent(
  expectedLibraryRevision: number | undefined,
  actualLibraryRevision: number | null
): boolean {
  return (
    expectedLibraryRevision === undefined ||
    expectedLibraryRevision === actualLibraryRevision
  )
}

export async function loadUniqueDistanceState(): Promise<UniqueDistanceState | null> {
  return prefGet<UniqueDistanceState>("uniqueDistanceState")
}

export function areUniqueDistancesCurrent(
  activities: ParsedActivity[],
  state: UniqueDistanceState | null,
  libraryRevision?: number
): boolean {
  if (
    state?.version !== UNIQUE_DISTANCE_VERSION ||
    state.activityIds.length !== activities.length ||
    (libraryRevision !== undefined && state.libraryRevision !== libraryRevision)
  ) {
    return false
  }
  const activityIds = activities.map((activity) => activity.id).sort()
  const savedIds = [...state.activityIds].sort()
  return activities.every((_, index) => activityIds[index] === savedIds[index])
}

/** Atomically persists recalculated values, their library marker, and an optional deletion. */
export async function saveUniqueDistances(
  activities: ParsedActivity[],
  options: SaveUniqueDistancesOptions = {}
): Promise<UniqueDistanceSaveResult> {
  const db = await getDb()
  if (!db) {
    return {
      status: "unavailable",
      error: new Error("IndexedDB is unavailable."),
    }
  }
  try {
    const tx = db.transaction(
      ["activities", "prefs", "library-meta"],
      "readwrite"
    )
    const activityStore = tx.objectStore("activities")
    const metaStore = tx.objectStore("library-meta")
    const rawMeta = await promisifyRequest<
      { key?: unknown; revision?: unknown } | undefined
    >(metaStore.get("library"))
    const actualLibraryRevision =
      typeof rawMeta?.revision === "number" &&
      Number.isSafeInteger(rawMeta.revision) &&
      rawMeta.revision >= 0
        ? rawMeta.revision
        : null
    if (
      options.libraryRevision !== undefined &&
      !isUniqueDistanceRevisionCurrent(
        options.libraryRevision,
        actualLibraryRevision
      )
    ) {
      tx.abort()
      return {
        status: "stale",
        expectedLibraryRevision: options.libraryRevision,
        actualLibraryRevision,
      }
    }
    if (options.deletedActivityId) {
      activityStore.delete(options.deletedActivityId)
    }
    for (const activity of activities) activityStore.put(activity)
    const revision = options.libraryRevision ?? actualLibraryRevision ?? 0
    tx.objectStore("prefs").put({
      key: "uniqueDistanceState",
      value: {
        version: UNIQUE_DISTANCE_VERSION,
        libraryRevision: revision,
        activityIds: activities.map((activity) => activity.id).sort(),
      } satisfies UniqueDistanceState,
    } satisfies PrefEntry)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
    return { status: "saved", libraryRevision: revision }
  } catch (err) {
    console.warn("[storage] saveUniqueDistances failed:", err)
    return { status: "failed", error: err }
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

async function prefSet(
  key: string,
  value: unknown,
  options: { throwOnError?: boolean } = {}
): Promise<void> {
  const db = await getDb()
  if (!db) {
    if (options.throwOnError) {
      throw new Error("Local storage is unavailable.")
    }
    return
  }
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
    if (options.throwOnError) throw err
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
  const validation = validateFogRenderData(cache.fogData)
  if (!validation.ok) {
    throw new Error("Fog cache geometry is invalid.")
  }
  return prefSet("fogCache", cache, { throwOnError: true })
}

export async function loadFogCache(): Promise<FogCache | null> {
  const cache = await prefGet<Partial<FogCache> & { trackIds?: string[] }>(
    "fogCache"
  )
  if (!cache) return null
  const activityIds = cache.activityIds ?? cache.trackIds
  if (
    !activityIds ||
    typeof cache.libraryRevision !== "number" ||
    cache.algorithmVersion !== FOG_ALGORITHM_VERSION ||
    cache.partitionSchemeVersion !== FOG_PARTITION_SCHEME_VERSION ||
    (cache.fogMode !== "corridor" && cache.fogMode !== "fill")
  ) {
    return null
  }
  if (!cache.fogData) return null
  const validation = validateFogRenderData(cache.fogData)
  if (!validation.ok) return null
  return {
    activityIds,
    libraryRevision: cache.libraryRevision,
    fogMode: cache.fogMode,
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    fogData: cache.fogData,
  }
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
  currentFogMode: FogMode,
  currentLibraryRevision?: number
): boolean {
  if (cache.fogMode !== currentFogMode) return false
  if (
    currentLibraryRevision !== undefined &&
    cache.libraryRevision !== currentLibraryRevision
  ) {
    return false
  }
  if (
    cache.algorithmVersion !== FOG_ALGORITHM_VERSION ||
    cache.partitionSchemeVersion !== FOG_PARTITION_SCHEME_VERSION
  ) {
    return false
  }
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
  /** Short-lived cross-tab sync leadership lease. */
  syncLeaseOwner?: string
  syncLeaseUntil?: number
}

/** Sync state owned exclusively by the saved-point reconciler. */
export interface SavedPointSyncState {
  /** Saved-point manifest cursor, independent from the activity cursor. */
  cursor: number
  lastSyncAt: number
  /** Known remote saved-point ids retained across incremental windows. */
  serverPointIds: string[]
  /** Saved-point tombstones already applied locally, id → deletedAt. */
  appliedTombstones: Record<string, number>
  /** Local creates/edits awaiting a successful upsert. */
  outboundIds: string[]
  /** Local deletions awaiting a successful tombstone. */
  outboundDeletionIds: string[]
}

function isSavedPointSyncState(value: unknown): value is SavedPointSyncState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<SavedPointSyncState>
  const isStringArray = (input: unknown): input is string[] =>
    Array.isArray(input) && input.every((entry) => typeof entry === "string")
  const isTombstoneMap = (input: unknown): input is Record<string, number> =>
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.values(input).every(
      (deletedAt) =>
        typeof deletedAt === "number" &&
        Number.isFinite(deletedAt) &&
        deletedAt >= 0
    )
  return (
    typeof candidate.cursor === "number" &&
    Number.isFinite(candidate.cursor) &&
    candidate.cursor >= 0 &&
    typeof candidate.lastSyncAt === "number" &&
    Number.isFinite(candidate.lastSyncAt) &&
    candidate.lastSyncAt >= 0 &&
    isStringArray(candidate.serverPointIds) &&
    isTombstoneMap(candidate.appliedTombstones) &&
    isStringArray(candidate.outboundIds) &&
    isStringArray(candidate.outboundDeletionIds)
  )
}

export function migrateSavedPointSyncState(
  state: SyncState
): SavedPointSyncState | null {
  if (
    state.savedPointsCursor === undefined &&
    state.serverSavedPointIds === undefined &&
    state.appliedSavedPointTombstones === undefined &&
    state.outboundSavedPointIds === undefined &&
    state.outboundSavedPointDeletionIds === undefined
  ) {
    return null
  }
  return {
    cursor: state.savedPointsCursor ?? 0,
    lastSyncAt: state.lastSyncAt,
    serverPointIds: [...(state.serverSavedPointIds ?? [])],
    appliedTombstones: {
      ...(state.appliedSavedPointTombstones ?? {}),
    },
    outboundIds: [...(state.outboundSavedPointIds ?? [])],
    outboundDeletionIds: [...(state.outboundSavedPointDeletionIds ?? [])],
  }
}

const EMPTY_SAVED_POINT_SYNC_STATE: SavedPointSyncState = {
  cursor: 0,
  lastSyncAt: 0,
  serverPointIds: [],
  appliedTombstones: {},
  outboundIds: [],
  outboundDeletionIds: [],
}

export async function saveSyncState(state: SyncState): Promise<void> {
  return prefSet("syncState", state)
}

export async function loadSyncState(): Promise<SyncState | null> {
  return prefGet<SyncState>("syncState")
}

export async function saveSavedPointSyncState(
  state: SavedPointSyncState
): Promise<void> {
  return prefSet("savedPointSyncState", state)
}

/**
 * Load the dedicated saved-point state, migrating the old shared preference
 * once when necessary. The migration is intentionally one-way: activity sync
 * never writes this key and saved-point sync never writes `syncState`.
 */
export async function loadSavedPointSyncState(): Promise<SavedPointSyncState | null> {
  const current = await prefGet<SavedPointSyncState>("savedPointSyncState")
  if (current && isSavedPointSyncState(current)) return current

  const legacy = await prefGet<SyncState>("syncState")
  if (legacy) {
    const migrated = migrateSavedPointSyncState(legacy)
    if (migrated) {
      await prefSet("savedPointSyncState", migrated)
      return migrated
    }
  }
  return null
}

export function emptySavedPointSyncState(): SavedPointSyncState {
  return {
    ...EMPTY_SAVED_POINT_SYNC_STATE,
    appliedTombstones: {},
  }
}

export async function clearSyncState(
  options: { allAccounts?: boolean } = {}
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction(["sync-state", "prefs"], "readwrite")
    const stateStore = tx.objectStore("sync-state")
    if (options.allAccounts) {
      const keys = await promisifyRequest<IDBValidKey[]>(stateStore.getAllKeys())
      for (const key of keys) stateStore.delete(key)
    } else {
      stateStore.delete("default")
    }
    tx.objectStore("prefs").delete("syncState")
    tx.objectStore("prefs").delete("savedPointSyncState")
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (err) {
    console.warn("[storage] clearSyncState failed:", err)
  }
}

// ─── Clear all ────────────────────────────────────────────────────────────────

/**
 * Wipe persisted library data and its derived state. Used by "clear-all".
 *
 * The session and user preferences are deliberately kept: clearing the map is
 * neither signing out nor resetting controls such as Fill loops. The sync cursor
 * *is* dropped, so the next sync re-walks the manifest from zero rather than
 * believing it is already up to date with activities that are gone.
 */
export async function clearAll(
  options: { includeActivities?: boolean } = {}
): Promise<void> {
  const activityClear =
    options.includeActivities === false ? Promise.resolve() : clearActivities()
  await Promise.all([
    activityClear,
    clearPhotos(),
    clearSavedPoints(),
    prefDelete("fogCache"),
    clearSyncState({ allAccounts: true }),
    prefDelete("uniqueDistanceState"),
  ])
}
