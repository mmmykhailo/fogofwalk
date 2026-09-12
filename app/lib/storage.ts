import { ACTIVITY_TYPES } from "~/types/activities"
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
import type { ActivitySummary } from "~/types/activitySummary"
import type { ActivityType, StartSunPhase } from "~/types/activities"

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
  /** Only complete positive projections are safe to restore as a base. */
  completeness: "complete"
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
const START_SUN_PHASES = [
  "before_sunrise",
  "daylight",
  "after_sunset",
  "unknown",
] as const

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

interface ActivitySettingsPatch {
  id: string
  isPublic?: boolean
  activityType?: ActivityType
}

export interface ActivityMetadataStoragePatch extends ActivitySettingsPatch {
  name?: string
  startedAtMs?: number | null
  startSunPhase?: StartSunPhase
}

function getStoredStartedAt(activity: StoredActivity): number | null {
  if (activity.startedAtMs !== undefined) return activity.startedAtMs
  return (
    activity.pointTimestamps?.find(
      (timestamp) => timestamp != null && isFinite(timestamp)
    ) ?? null
  )
}

/** Convert a full activity to the metadata needed by the library route. */
export function activityToSummary(
  activity: StoredActivity | ParsedActivity
): ActivitySummary {
  return {
    id: activity.id,
    name: activity.name,
    startedAtMs: getStoredStartedAt(activity),
    ...(activity.activityType ? { activityType: activity.activityType } : {}),
    ...(activity.startSunPhase
      ? { startSunPhase: activity.startSunPhase }
      : {}),
    ...(activity.contentHash ? { contentHash: activity.contentHash } : {}),
    isPublic: activity.isPublic ?? false,
    stats: {
      distanceKm: activity.stats.distanceKm,
      durationMs: activity.stats.durationMs,
      elevationGainM: activity.stats.elevationGainM,
      avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
    },
  }
}

function isActivitySummary(value: unknown): value is ActivitySummary {
  if (value == null || typeof value !== "object") return false
  const summary = value as Partial<ActivitySummary>
  const stats = summary.stats
  if (stats == null || typeof stats !== "object") return false

  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value)
  const isNullableFiniteNumber = (value: unknown): value is number | null =>
    value === null || isFiniteNumber(value)
  const isKnownValue = <T extends string>(
    value: unknown,
    values: readonly T[]
  ): value is T => typeof value === "string" && values.includes(value as T)

  return (
    typeof summary.id === "string" &&
    typeof summary.name === "string" &&
    isNullableFiniteNumber(summary.startedAtMs) &&
    isFiniteNumber(stats.distanceKm) &&
    isNullableFiniteNumber(stats.durationMs) &&
    isFiniteNumber(stats.elevationGainM) &&
    isNullableFiniteNumber(stats.avgMovingSpeedKmh) &&
    (summary.activityType === undefined ||
      isKnownValue(summary.activityType, ACTIVITY_TYPES)) &&
    (summary.startSunPhase === undefined ||
      isKnownValue(summary.startSunPhase, START_SUN_PHASES)) &&
    (summary.contentHash === undefined ||
      typeof summary.contentHash === "string") &&
    (summary.isPublic === undefined || typeof summary.isPublic === "boolean")
  )
}

function hasCompleteActivitySummarySet(
  activityKeys: readonly IDBValidKey[],
  storedSummaries: readonly unknown[]
): storedSummaries is ActivitySummary[] {
  if (activityKeys.length !== storedSummaries.length) return false

  const activityIds = new Set<string>()
  for (const key of activityKeys) {
    if (typeof key !== "string" || activityIds.has(key)) return false
    activityIds.add(key)
  }

  const summaryIds = new Set<string>()
  for (const value of storedSummaries) {
    if (!isActivitySummary(value) || summaryIds.has(value.id)) return false
    summaryIds.add(value.id)
  }

  return (
    summaryIds.size === activityIds.size &&
    [...summaryIds].every((id) => activityIds.has(id))
  )
}

function sortActivitySummaries(
  summaries: readonly ActivitySummary[]
): ActivitySummary[] {
  return [...summaries].sort((a, b) => {
    if (a.startedAtMs == null && b.startedAtMs == null) return 0
    if (a.startedAtMs == null) return 1
    if (b.startedAtMs == null) return -1
    return a.startedAtMs - b.startedAtMs
  })
}

// ─── DB singleton ──────────────────────────────────────────────────────────────

const DB_NAME = "fogofwalk"
const DB_VERSION = 7

let dbPromise: Promise<IDBDatabase | null> | null = null
let activitySummariesFallback: ActivitySummary[] | null = null

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

        if (!db.objectStoreNames.contains("activity-summaries")) {
          db.createObjectStore("activity-summaries", { keyPath: "id" })
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

        if (e.oldVersion < 7) {
          const activityStore = tx.objectStore("activities")
          const summaryStore = tx.objectStore("activity-summaries")
          const cursorRequest = activityStore.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor) {
              summaryStore.put(
                activityToSummary(cursor.value as StoredActivity)
              )
              cursor.continue()
            }
          }
        }
      }

      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        console.warn("[storage] IndexedDB open failed:", req.error)
        dbPromise = null
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

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"))
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"))
  })
}

function abortTransaction(tx: IDBTransaction | null): void {
  if (!tx) return
  try {
    tx.abort()
  } catch {
    // The transaction may already have completed or aborted.
  }
}

function invalidateActivitySummariesFallback(): void {
  activitySummariesFallback = null
}

// ─── Activities ───────────────────────────────────────────────────────────────────

/** Upsert activities into storage. Uses put, so re-adding the same ID is idempotent. */
export async function saveActivities(
  activities: ParsedActivity[]
): Promise<void> {
  if (activities.length === 0) return
  invalidateActivitySummariesFallback()
  const db = await getDb()
  if (!db) return
  let tx: IDBTransaction | null = null
  try {
    tx = db.transaction(["activities", "activity-summaries"], "readwrite")
    const store = tx.objectStore("activities")
    const summaryStore = tx.objectStore("activity-summaries")
    for (const activity of activities) {
      store.put(activity)
      summaryStore.put(activityToSummary(activity))
    }
    await waitForTransaction(tx)
  } catch (err) {
    abortTransaction(tx)
    console.warn("[storage] saveActivities failed:", err)
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

/** Load all persisted activities, overlaying the small metadata store. */
export async function loadActivities(): Promise<ParsedActivity[]> {
  if (fullActivitiesLoad) return fullActivitiesLoad
  fullActivitiesLoad = loadFullActivities().finally(() => {
    fullActivitiesLoad = null
  })
  return fullActivitiesLoad
}

let fullActivitiesLoad: Promise<ParsedActivity[]> | null = null

async function loadFullActivities(): Promise<ParsedActivity[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const tx = db.transaction(["activities", "activity-summaries"], "readonly")
    const [activities, summaries] = await Promise.all([
      promisifyRequest<StoredActivity[]>(tx.objectStore("activities").getAll()),
      promisifyRequest<ActivitySummary[]>(
        tx.objectStore("activity-summaries").getAll()
      ),
    ])
    const summaryById = new Map(
      summaries
        .filter(isActivitySummary)
        .map((summary) => [summary.id, summary])
    )
    return activities.map((storedActivity) => {
      const activity = migrateStoredActivity(storedActivity)
      const summary = summaryById.get(activity.id)
      if (summary) {
        activity.name = summary.name
        activity.startedAtMs = summary.startedAtMs
        activity.activityType = summary.activityType
        activity.startSunPhase = summary.startSunPhase
        activity.contentHash = summary.contentHash
        activity.isPublic = summary.isPublic ?? false
      }
      return activity
    })
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

/** Load activities without touching the derived summary store. */
async function loadActivitiesForSummaryRecovery(): Promise<
  ParsedActivity[] | null
> {
  const db = await getDb()
  if (!db) return null
  try {
    const tx = db.transaction("activities", "readonly")
    const activities = await promisifyRequest<StoredActivity[]>(
      tx.objectStore("activities").getAll()
    )

    let summaries: unknown[] = []
    try {
      const summaryTx = db.transaction("activity-summaries", "readonly")
      summaries = await promisifyRequest<unknown[]>(
        summaryTx.objectStore("activity-summaries").getAll()
      )
    } catch (err) {
      console.warn("[storage] summary overlay load failed:", err)
    }
    const summaryById = new Map(
      summaries
        .filter(isActivitySummary)
        .map((summary) => [summary.id, summary])
    )

    for (const activity of activities) {
      activity.startedAtMs = getStoredStartedAt(activity)
      activity.isPublic = activity.isPublic ?? false
      if (activity.stats.uniqueDistanceKm === undefined) {
        activity.stats.uniqueDistanceKm = activity.stats.distanceKm
      }
      const summary = summaryById.get(activity.id)
      if (summary) {
        activity.name = summary.name
        activity.startedAtMs = summary.startedAtMs
        activity.activityType = summary.activityType
        activity.startSunPhase = summary.startSunPhase
        activity.contentHash = summary.contentHash
        activity.isPublic = summary.isPublic ?? false
      }
    }
    return activities as ParsedActivity[]
  } catch (err) {
    console.warn("[storage] summary recovery activity load failed:", err)
    return null
  }
}

/** Load only the metadata needed by the activities route. */
export async function loadActivitySummaries(): Promise<ActivitySummary[]> {
  if (activitySummariesLoad) return activitySummariesLoad
  activitySummariesLoad = loadStoredActivitySummaries().finally(() => {
    activitySummariesLoad = null
  })
  return activitySummariesLoad
}

let activitySummariesLoad: Promise<ActivitySummary[]> | null = null

async function loadStoredActivitySummaries(): Promise<ActivitySummary[]> {
  const db = await getDb()
  if (!db) return activitySummariesFallback ?? []
  try {
    const tx = db.transaction(["activities", "activity-summaries"], "readonly")
    const [activityKeys, storedSummaries] = await Promise.all([
      promisifyRequest<IDBValidKey[]>(
        tx.objectStore("activities").getAllKeys()
      ),
      promisifyRequest<unknown[]>(
        tx.objectStore("activity-summaries").getAll()
      ),
    ])
    if (hasCompleteActivitySummarySet(activityKeys, storedSummaries)) {
      const summaries = storedSummaries
      activitySummariesFallback = null
      return sortActivitySummaries(summaries)
    }
  } catch (err) {
    console.warn("[storage] loadActivitySummaries failed:", err)
  }

  // A partial/corrupt summary store must never turn a populated library into
  // an empty page. This fallback is intentionally full-sized and is only used
  // while recovering the summary store.
  const fullActivities = await loadActivitiesForSummaryRecovery()
  if (fullActivities == null) return activitySummariesFallback ?? []
  const summaries = sortActivitySummaries(fullActivities.map(activityToSummary))
  const persisted = await replaceActivitySummaries(summaries)
  activitySummariesFallback = persisted ? null : summaries
  return summaries
}

/** Replace the summary store atomically; unlike upserts, this removes orphans. */
async function replaceActivitySummaries(
  summaries: readonly ActivitySummary[]
): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  let tx: IDBTransaction | null = null
  try {
    tx = db.transaction("activity-summaries", "readwrite")
    const store = tx.objectStore("activity-summaries")
    store.clear()
    for (const summary of summaries) store.put(summary)
    await waitForTransaction(tx)
    return true
  } catch (err) {
    abortTransaction(tx)
    console.warn("[storage] replaceActivitySummaries failed:", err)
    return false
  }
}

/** Update only activity metadata; geometry is never read or rewritten. */
export async function updateActivitySettings(
  updates: readonly ActivitySettingsPatch[]
): Promise<boolean> {
  return updateActivityMetadata(updates)
}

/** Update summary metadata without reading or rewriting activity geometry. */
export async function updateActivityMetadata(
  updates: readonly ActivityMetadataStoragePatch[]
): Promise<boolean> {
  if (updates.length === 0) return true
  invalidateActivitySummariesFallback()
  const db = await getDb()
  if (!db) return true
  try {
    const tx = db.transaction("activity-summaries", "readwrite")
    const store = tx.objectStore("activity-summaries")
    for (const update of updates) {
      const request = store.get(update.id)
      request.onsuccess = () => {
        const summary = request.result
        if (!isActivitySummary(summary)) {
          tx.abort()
          return
        }
        if (update.name !== undefined) summary.name = update.name
        if (update.startedAtMs !== undefined)
          summary.startedAtMs = update.startedAtMs
        if (update.isPublic !== undefined) summary.isPublic = update.isPublic
        if ("activityType" in update) summary.activityType = update.activityType
        if ("startSunPhase" in update)
          summary.startSunPhase = update.startSunPhase
        store.put(summary)
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return true
  } catch (err) {
    console.warn("[storage] updateActivitySettings failed:", err)
    return false
  }
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

/** Atomically persists recalculated values, summaries, their marker, and an optional deletion. */
export async function saveUniqueDistances(
  activities: ParsedActivity[],
  options: SaveUniqueDistancesOptions = {}
): Promise<UniqueDistanceSaveResult> {
  invalidateActivitySummariesFallback()
  const db = await getDb()
  if (!db) {
    return {
      status: "unavailable",
      error: new Error("IndexedDB is unavailable."),
    }
  }
  let tx: IDBTransaction | null = null
  try {
    tx = db.transaction(
      ["activities", "activity-summaries", "prefs", "library-meta"],
      "readwrite"
    )
    const activityStore = tx.objectStore("activities")
    const summaryStore = tx.objectStore("activity-summaries")
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
      summaryStore.delete(options.deletedActivityId)
    }
    for (const activity of activities) {
      activityStore.put(activity)
      summaryStore.put(activityToSummary(activity))
    }
    const revision = options.libraryRevision ?? actualLibraryRevision ?? 0
    tx.objectStore("prefs").put({
      key: "uniqueDistanceState",
      value: {
        version: UNIQUE_DISTANCE_VERSION,
        libraryRevision: revision,
        activityIds: activities.map((activity) => activity.id).sort(),
      } satisfies UniqueDistanceState,
    } satisfies PrefEntry)
    await waitForTransaction(tx)
    return { status: "saved", libraryRevision: revision }
  } catch (err) {
    abortTransaction(tx)
    console.warn("[storage] saveUniqueDistances failed:", err)
    return { status: "failed", error: err }
  }
}

/** Delete a single activity by id from storage. */
export async function deleteActivity(id: string): Promise<void> {
  invalidateActivitySummariesFallback()
  const db = await getDb()
  if (!db) return
  let tx: IDBTransaction | null = null
  try {
    tx = db.transaction(["activities", "activity-summaries"], "readwrite")
    tx.objectStore("activities").delete(id)
    tx.objectStore("activity-summaries").delete(id)
    await waitForTransaction(tx)
  } catch (err) {
    abortTransaction(tx)
    console.warn("[storage] deleteActivity failed:", err)
  }
}

/** Delete all activities from storage. */
export async function clearActivities(): Promise<void> {
  invalidateActivitySummariesFallback()
  const db = await getDb()
  if (!db) return
  let tx: IDBTransaction | null = null
  try {
    tx = db.transaction(["activities", "activity-summaries"], "readwrite")
    tx.objectStore("activities").clear()
    tx.objectStore("activity-summaries").clear()
    await waitForTransaction(tx)
  } catch (err) {
    abortTransaction(tx)
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
  const validation = validateFogRenderData(cache.fogData, {
    allowInteriorRings: true,
  })
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
    cache.completeness !== "complete" ||
    (cache.fogMode !== "corridor" && cache.fogMode !== "fill")
  ) {
    return null
  }
  if (!cache.fogData) return null
  const validation = validateFogRenderData(cache.fogData, {
    allowInteriorRings: true,
  })
  if (!validation.ok) return null
  return {
    activityIds,
    libraryRevision: cache.libraryRevision,
    fogMode: cache.fogMode,
    algorithmVersion: FOG_ALGORITHM_VERSION,
    partitionSchemeVersion: FOG_PARTITION_SCHEME_VERSION,
    completeness: "complete",
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
    cache.partitionSchemeVersion !== FOG_PARTITION_SCHEME_VERSION ||
    cache.completeness !== "complete"
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
  /** Point ids first associated with this account on this device. */
  ownedIds: string[]
  /** Saved-point tombstones already applied locally, id → deletedAt. */
  appliedTombstones: Record<string, number>
  /** Local creates/edits awaiting a successful upsert. */
  outboundIds: string[]
  /** Local deletions awaiting a successful tombstone. */
  outboundDeletionIds: string[]
}

const SAVED_POINT_SYNC_STATE_KEY = "savedPointSyncState"
const SAVED_POINT_SYNC_STATE_ACCOUNT_PREFIX = `${SAVED_POINT_SYNC_STATE_KEY}:`

export function savedPointSyncStateKey(accountId?: string): string {
  return accountId === undefined
    ? SAVED_POINT_SYNC_STATE_KEY
    : `${SAVED_POINT_SYNC_STATE_ACCOUNT_PREFIX}${encodeURIComponent(accountId)}`
}

function accountIdFromSavedPointSyncStateKey(key: string): string | null {
  if (!key.startsWith(SAVED_POINT_SYNC_STATE_ACCOUNT_PREFIX)) return null
  try {
    return decodeURIComponent(
      key.slice(SAVED_POINT_SYNC_STATE_ACCOUNT_PREFIX.length)
    )
  } catch {
    return null
  }
}

function uniqueIds(...groups: (readonly string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
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
    (candidate.ownedIds === undefined || isStringArray(candidate.ownedIds)) &&
    isTombstoneMap(candidate.appliedTombstones) &&
    isStringArray(candidate.outboundIds) &&
    isStringArray(candidate.outboundDeletionIds)
  )
}

function normalizeSavedPointSyncState(
  value: unknown
): SavedPointSyncState | null {
  if (!isSavedPointSyncState(value)) return null
  return {
    cursor: value.cursor,
    lastSyncAt: value.lastSyncAt,
    serverPointIds: [...value.serverPointIds],
    ownedIds: uniqueIds(
      value.ownedIds,
      value.serverPointIds,
      value.outboundIds,
      value.outboundDeletionIds
    ),
    appliedTombstones: { ...value.appliedTombstones },
    outboundIds: [...value.outboundIds],
    outboundDeletionIds: [...value.outboundDeletionIds],
  }
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
    ownedIds: uniqueIds(
      state.serverSavedPointIds,
      state.outboundSavedPointIds,
      state.outboundSavedPointDeletionIds
    ),
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
  ownedIds: [],
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
  state: SavedPointSyncState,
  accountId?: string
): Promise<void> {
  return prefSet(savedPointSyncStateKey(accountId), state)
}

/**
 * Read the saved-point state in the same transaction used for any one-time
 * namespace migration. Keeping this operation transactional prevents two tabs
 * from both adopting the unscoped record or interleaving a state update.
 */
async function readSavedPointSyncStateInTransaction(
  store: IDBObjectStore,
  accountId?: string
): Promise<SavedPointSyncState | null> {
  const key = savedPointSyncStateKey(accountId)
  const current = await promisifyRequest<PrefEntry | undefined>(store.get(key))
  const normalized = normalizeSavedPointSyncState(current?.value)
  if (normalized) {
    // Older dedicated records did not carry ownership metadata. Persist the
    // derived value once, while still returning a defensive copy to callers.
    if (
      !current?.value ||
      !Array.isArray((current.value as Partial<SavedPointSyncState>).ownedIds)
    ) {
      store.put({ key, value: normalized })
    }
    return normalized
  }

  // A signed-in account adopts the unscoped saved-point state only once. The
  // sign-out path removes this base key, while account-scoped records survive
  // so another account cannot inherit its cursor or pending work.
  if (accountId !== undefined) {
    const unscoped = await promisifyRequest<PrefEntry | undefined>(
      store.get(SAVED_POINT_SYNC_STATE_KEY)
    )
    const unscopedState = normalizeSavedPointSyncState(unscoped?.value)
    if (unscopedState) {
      store.put({ key, value: unscopedState })
      store.delete(SAVED_POINT_SYNC_STATE_KEY)
      return unscopedState
    }
  }

  // The activity repository may still need this legacy record to migrate its
  // own fields. Copy saved-point fields before that repository can remove it;
  // deliberately leave `syncState` in place for the activity migration.
  const legacy = await promisifyRequest<PrefEntry | undefined>(
    store.get("syncState")
  )
  if (
    legacy &&
    typeof legacy.value === "object" &&
    legacy.value !== null &&
    !Array.isArray(legacy.value)
  ) {
    const migrated = normalizeSavedPointSyncState(
      migrateSavedPointSyncState(legacy.value as SyncState)
    )
    if (migrated) {
      store.put({ key, value: migrated })
      return migrated
    }
  }
  return null
}

export async function loadSavedPointSyncState(
  accountId?: string
): Promise<SavedPointSyncState | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const tx = db.transaction("prefs", "readwrite")
    const state = await readSavedPointSyncStateInTransaction(
      tx.objectStore("prefs"),
      accountId
    )
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return state
  } catch (err) {
    console.warn(
      `[storage] loadSavedPointSyncState(${accountId ?? "unscoped"}) failed:`,
      err
    )
    return null
  }
}

/**
 * Atomically read, transform, and persist one account's saved-point state.
 * This is the only API used for queued point mutations so cursor and outbox
 * fields cannot be lost to a stale read-modify-write from another tab.
 */
export async function updateSavedPointSyncState(
  accountId: string | undefined,
  update: (state: SavedPointSyncState | null) => SavedPointSyncState | null
): Promise<SavedPointSyncState | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const tx = db.transaction("prefs", "readwrite")
    const store = tx.objectStore("prefs")
    const current = await readSavedPointSyncStateInTransaction(store, accountId)
    const next = update(current)
    const key = savedPointSyncStateKey(accountId)
    if (next === null) {
      store.delete(key)
    } else {
      const normalized = normalizeSavedPointSyncState(next)
      if (!normalized) throw new Error("Invalid saved-point sync state")
      store.put({ key, value: normalized })
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return next === null ? null : normalizeSavedPointSyncState(next)
  } catch (err) {
    console.warn(
      `[storage] updateSavedPointSyncState(${accountId ?? "unscoped"}) failed:`,
      err
    )
    return null
  }
}

/** Load valid account-scoped point state for cross-account ownership checks. */
export async function loadAccountSavedPointSyncStates(): Promise<
  Map<string, SavedPointSyncState>
> {
  const db = await getDb()
  if (!db) return new Map()
  try {
    const tx = db.transaction("prefs", "readonly")
    const entries = await promisifyRequest<PrefEntry[]>(
      tx.objectStore("prefs").getAll()
    )
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const states = new Map<string, SavedPointSyncState>()
    for (const entry of entries) {
      if (typeof entry.key !== "string") continue
      const accountId = accountIdFromSavedPointSyncStateKey(entry.key)
      if (accountId === null) continue
      const state = normalizeSavedPointSyncState(entry.value)
      if (state) states.set(accountId, state)
    }
    return states
  } catch (err) {
    console.warn("[storage] loadAccountSavedPointSyncStates failed:", err)
    return new Map()
  }
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
    const prefsStore = tx.objectStore("prefs")
    if (options.allAccounts) {
      const keys = await promisifyRequest<IDBValidKey[]>(
        stateStore.getAllKeys()
      )
      for (const key of keys) stateStore.delete(key)
      const prefKeys = await promisifyRequest<IDBValidKey[]>(
        prefsStore.getAllKeys()
      )
      for (const key of prefKeys) {
        if (
          typeof key === "string" &&
          (key === "syncState" ||
            key === SAVED_POINT_SYNC_STATE_KEY ||
            key.startsWith(SAVED_POINT_SYNC_STATE_ACCOUNT_PREFIX))
        ) {
          prefsStore.delete(key)
        }
      }
    } else {
      stateStore.delete("default")
      prefsStore.delete("syncState")
      prefsStore.delete(SAVED_POINT_SYNC_STATE_KEY)
    }
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
