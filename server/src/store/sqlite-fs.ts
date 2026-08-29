/**
 * Default driver: `bun:sqlite` for metadata, gzipped geometry on disk.
 *
 *   DATA_DIR/fogofwalk.db          metadata (WAL)
 *   DATA_DIR/blobs/<userId>/<contentHash>.json.gz
 *
 * One file plus one folder to back up. See the Storage drivers table in
 * `server/README.md` for the alternatives (`sqlite-blob`, `postgres-bytea`,
 * `postgres-s3`).
 */

import { Database } from "bun:sqlite"
import { $ } from "bun"

import type {
  AdminAccessRequest,
  AdminUser,
  ManifestPage,
  PublicProfileResponse,
  PublicActivityMeta,
  ActivityMeta,
  ActivityTombstone,
  SavedPointManifestPage,
  SavedPointTombstone,
  UserStatus,
} from "~shared/api"
import type { SavedPoint, SavedPointColor } from "~shared/saved-points"
import { SYNC_PAGE_SIZE } from "~shared/constants"
import type {
  ActivityFormat,
  ActivityType,
  StartSunPhase,
} from "~shared/activities"

import { combineCursors, pageStream } from "./manifestPaging"
import type { Pageable } from "./manifestPaging"
import { parseActivityUpload } from "../activities/payload"
import type {
  Identity,
  IdentityInput,
  ServerStore,
  Session,
  AccessRequestCreation,
  StoredAccessRequest,
  User,
} from "./types"

const CONTENT_HASH_RE = /^[a-f0-9]{64}$/
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Guard for every value that reaches a filesystem path. Content hashes arrive
 * straight from the URL, so `..%2F..%2Fetc%2Fpasswd` is a request away — this
 * is the only thing standing between that and `Bun.write`.
 */
export function isSafeContentHash(value: unknown): value is string {
  return typeof value === "string" && CONTENT_HASH_RE.test(value)
}

export function isSafeUserId(value: unknown): value is string {
  return typeof value === "string" && USER_ID_RE.test(value)
}

export function assertSafePathParts(userId: string, contentHash: string): void {
  if (!isSafeUserId(userId)) {
    throw new Error(`unsafe user id: ${JSON.stringify(userId)}`)
  }
  if (!isSafeContentHash(contentHash)) {
    throw new Error(`unsafe content hash: ${JSON.stringify(contentHash)}`)
  }
}

/** `<dataDir>/blobs/<userId>/<contentHash>.json.gz`, validated. */
export function blobPath(
  dataDir: string,
  userId: string,
  contentHash: string
): string {
  assertSafePathParts(userId, contentHash)
  return `${stripTrailingSlash(dataDir)}/blobs/${userId}/${contentHash}.json.gz`
}

export function userBlobDir(dataDir: string, userId: string): string {
  if (!isSafeUserId(userId)) {
    throw new Error(`unsafe user id: ${JSON.stringify(userId)}`)
  }
  return `${stripTrailingSlash(dataDir)}/blobs/${userId}`
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return (
    (db
      .query(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`)
      .get(column) as { 1: number } | null) !== null
  )
}

function hasTable(db: Database, table: string): boolean {
  return (
    (db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { 1: number } | null) !== null
  )
}

function migrateSchema(db: Database) {
  // Rename the pre-activity domain tables in place. SQLite preserves every
  // row and rewrites dependent schema references during ALTER TABLE, while the
  // blobs remain valid because their on-disk path is content-hash based.
  if (hasTable(db, "tracks") && !hasTable(db, "activities")) {
    db.exec("ALTER TABLE tracks RENAME TO activities")
  }
  if (
    hasTable(db, "track_tombstones") &&
    !hasTable(db, "activity_tombstones")
  ) {
    db.exec("ALTER TABLE track_tombstones RENAME TO activity_tombstones")
  }

  // Index names are not rewritten by ALTER TABLE. Drop the legacy names so
  // the idempotent schema below recreates them with activity terminology.
  db.exec("DROP INDEX IF EXISTS tracks_sync")
  db.exec("DROP INDEX IF EXISTS tracks_public_user")

  if (hasTable(db, "users") && !hasColumn(db, "users", "handle")) {
    db.exec("ALTER TABLE users ADD COLUMN handle TEXT")
    // Existing identities predate public profiles. Preserve their GitHub login
    // as the profile handle where it is unique.
    db.exec(`
      UPDATE OR IGNORE users
         SET handle = (
           SELECT provider_login
             FROM identities
            WHERE identities.user_id = users.id
              AND provider_login IS NOT NULL
            ORDER BY created_at
            LIMIT 1
         )
       WHERE handle IS NULL
    `)
  }

  if (hasTable(db, "activities") && !hasColumn(db, "activities", "is_public")) {
    db.exec(
      "ALTER TABLE activities ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0"
    )
  }
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "activity_type")
  ) {
    db.exec("ALTER TABLE activities ADD COLUMN activity_type TEXT")
  }
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "start_sun_phase")
  ) {
    db.exec("ALTER TABLE activities ADD COLUMN start_sun_phase TEXT")
  }

  // Denormalized stat fields for the public profile endpoint (avoids
  // decompressing every public activity's blob on each request). Nullable:
  // rows written before this migration stay NULL until the activity is
  // re-uploaded, matching PublicActivityMeta's existing null/0 fallbacks.
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "duration_ms")
  ) {
    db.exec("ALTER TABLE activities ADD COLUMN duration_ms REAL")
  }
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "moving_time_ms")
  ) {
    db.exec("ALTER TABLE activities ADD COLUMN moving_time_ms REAL")
  }
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "elevation_gain_m")
  ) {
    db.exec(
      "ALTER TABLE activities ADD COLUMN elevation_gain_m REAL NOT NULL DEFAULT 0"
    )
  }
  if (
    hasTable(db, "activities") &&
    !hasColumn(db, "activities", "avg_moving_speed_kmh")
  ) {
    db.exec("ALTER TABLE activities ADD COLUMN avg_moving_speed_kmh REAL")
  }
}

interface UserRow {
  id: string
  display_name: string
  handle: string | null
  avatar_url: string | null
  status: string
  created_at: number
  updated_at: number
}

interface IdentityRow {
  provider: string
  provider_user_id: string
  user_id: string
  provider_login: string | null
  email: string | null
  created_at: number
}

interface SessionRow {
  token_hash: string
  user_id: string
  created_at: number
  expires_at: number
  last_used_at: number
}

interface ActivityRow {
  content_hash: string
  name: string
  is_public: number
  format: string
  activity_type: string | null
  start_sun_phase: string | null
  started_at_ms: number | null
  distance_km: number
  point_count: number
  size_bytes: number
  updated_at: number
  duration_ms: number | null
  moving_time_ms: number | null
  elevation_gain_m: number
  avg_moving_speed_kmh: number | null
}

interface AdminUserStorageRow {
  activity_count: number
  public_activity_count: number
  activity_size_bytes: number
}

interface TombstoneRow {
  content_hash: string
  deleted_at: number
}

interface SavedPointRow {
  id: string
  longitude: number
  latitude: number
  name: string
  description: string | null
  colour: string
  is_public: number
  created_at: number
  updated_at: number
}

interface SavedPointTombstoneRow { id: string; deleted_at: number }

interface AccessRequestRow {
  id: string
  user_id: string
  status: string
  requested_at: number
  decided_at: number | null
  decided_by: string | null
  notification_status: string
  notification_attempted_at: number | null
}

function toAccessRequest(row: AccessRequestRow): StoredAccessRequest {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as StoredAccessRequest["status"],
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    notificationStatus:
      row.notification_status as StoredAccessRequest["notificationStatus"],
    notificationAttemptedAt: row.notification_attempted_at,
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    avatarUrl: row.avatar_url,
    status: row.status as UserStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toIdentity(row: IdentityRow): Identity {
  return {
    provider: row.provider,
    providerUserId: row.provider_user_id,
    userId: row.user_id,
    providerLogin: row.provider_login,
    email: row.email,
    createdAt: row.created_at,
  }
}

function toSession(row: SessionRow): Session {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  }
}

function toMeta(row: ActivityRow): ActivityMeta {
  return {
    contentHash: row.content_hash,
    name: row.name,
    isPublic: Boolean(row.is_public),
    format: row.format as ActivityFormat,
    activityType: (row.activity_type as ActivityType | null) ?? undefined,
    startSunPhase: (row.start_sun_phase as StartSunPhase | null) ?? undefined,
    startedAtMs: row.started_at_ms,
    distanceKm: row.distance_km,
    pointCount: row.point_count,
    sizeBytes: row.size_bytes,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    movingTimeMs: row.moving_time_ms,
    elevationGainM: row.elevation_gain_m,
    avgMovingSpeedKmh: row.avg_moving_speed_kmh,
  }
}

function toSavedPoint(row: SavedPointRow): SavedPoint {
  return { id: row.id, lng: row.longitude, lat: row.latitude, name: row.name, description: row.description, color: row.colour as SavedPointColor, isPublic: Boolean(row.is_public), createdAt: row.created_at, updatedAt: row.updated_at }
}

export class SqliteFsStore implements ServerStore {
  private readonly db: Database
  private readonly dataDir: string

  constructor(db: Database, dataDir: string) {
    this.db = db
    this.dataDir = stripTrailingSlash(dataDir)
  }

  // ── users & identities ──────────────────────────────────────────────────

  async findUserByIdentity(
    provider: string,
    providerUserId: string
  ): Promise<User | null> {
    const row = this.db
      .query(
        `SELECT u.* FROM users u
           JOIN identities i ON i.user_id = u.id
          WHERE i.provider = ? AND i.provider_user_id = ?`
      )
      .get(provider, providerUserId) as UserRow | null
    return row ? toUser(row) : null
  }

  async upsertUserFromIdentity(input: IdentityInput): Promise<User> {
    const now = Date.now()
    const existing = await this.findUserByIdentity(
      input.provider,
      input.providerUserId
    )

    if (existing) {
      this.db
        .query(
          `UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(input.displayName, input.avatarUrl, now, existing.id)
      // `handle` is UNIQUE and only ever set once: if it's already populated
      // (whether from a prior sign-in or the migration backfill) it's left
      // alone, and if the provider login collides with someone else's handle
      // `OR IGNORE` swallows the constraint violation rather than failing
      // sign-in — the user just keeps no handle.
      this.db
        .query(
          `UPDATE OR IGNORE users SET handle = ?
            WHERE id = ? AND handle IS NULL`
        )
        .run(input.login, existing.id)
      this.db
        .query(
          `UPDATE identities SET provider_login = ?, email = ?
            WHERE provider = ? AND provider_user_id = ?`
        )
        .run(input.login, input.email, input.provider, input.providerUserId)
      const updated = await this.getUser(existing.id)
      return updated ?? existing
    }

    const id = crypto.randomUUID()
    this.db
      .query(
        `INSERT INTO users (id, display_name, handle, avatar_url, status, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'pending', ?, ?)`
      )
      .run(id, input.displayName, input.avatarUrl, now, now)
    // Best-effort handle claim — see the comment on the existing-user path
    // above for why a collision must not fail sign-in.
    this.db
      .query(`UPDATE OR IGNORE users SET handle = ? WHERE id = ?`)
      .run(input.login, id)
    this.db
      .query(
        `INSERT INTO identities
           (provider, provider_user_id, user_id, provider_login, email, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.provider,
        input.providerUserId,
        id,
        input.login,
        input.email,
        now
      )

    const created = await this.getUser(id)
    if (!created) throw new Error("failed to create user")
    return created
  }

  async getUser(userId: string): Promise<User | null> {
    const row = this.db
      .query(`SELECT * FROM users WHERE id = ?`)
      .get(userId) as UserRow | null
    return row ? toUser(row) : null
  }

  async setUserStatus(
    userId: string,
    status: UserStatus
  ): Promise<User | null> {
    this.db
      .query(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), userId)
    return this.getUser(userId)
  }

  async setUserStatusWithAccessRequest(
    userId: string,
    status: UserStatus,
    adminUserId: string
  ): Promise<User | null> {
    const now = Date.now()
    const requestStatus =
      status === "allowed"
        ? "approved"
        : status === "blocked"
          ? "rejected"
          : "pending"
    this.db.transaction(() => {
      this.db
        .query(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
        .run(status, now, userId)
      this.db
        .query(
          `UPDATE access_requests
             SET status = ?, decided_at = ?, decided_by = ?
           WHERE user_id = ?`
        )
        .run(
          requestStatus,
          status === "pending" ? null : now,
          status === "pending" ? null : adminUserId,
          userId
        )
    })()
    return this.getUser(userId)
  }

  async findPrimaryIdentity(userId: string): Promise<Identity | null> {
    const row = this.db
      .query(
        `SELECT * FROM identities WHERE user_id = ?
          ORDER BY created_at ASC, provider ASC LIMIT 1`
      )
      .get(userId) as IdentityRow | null
    return row ? toIdentity(row) : null
  }

  async findIdentitiesForUser(userId: string): Promise<Identity[]> {
    const rows = this.db
      .query(
        `SELECT * FROM identities WHERE user_id = ? ORDER BY created_at ASC`
      )
      .all(userId) as IdentityRow[]
    return rows.map(toIdentity)
  }

  async deleteUser(userId: string): Promise<void> {
    this.db.transaction(() => {
      this.db.query(`DELETE FROM access_requests WHERE user_id = ?`).run(userId)
      this.db
        .query(`DELETE FROM activity_tombstones WHERE user_id = ?`)
        .run(userId)
      this.db.query(`DELETE FROM saved_point_tombstones WHERE user_id = ?`).run(userId)
      this.db.query(`DELETE FROM saved_points WHERE user_id = ?`).run(userId)
      this.db.query(`DELETE FROM activities WHERE user_id = ?`).run(userId)
      this.db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId)
      this.db.query(`DELETE FROM identities WHERE user_id = ?`).run(userId)
      this.db.query(`DELETE FROM users WHERE id = ?`).run(userId)
    })()

    if (!isSafeUserId(userId)) return
    const dir = userBlobDir(this.dataDir, userId)
    // Bun Shell (built in — no node:fs). Interpolations are escaped by Bun,
    // and `userId` was validated above, so this cannot expand into anything
    // but the one directory.
    await $`rm -rf ${dir}`.quiet().nothrow()
  }

  async getAccessRequest(userId: string): Promise<StoredAccessRequest | null> {
    const row = this.db
      .query(`SELECT * FROM access_requests WHERE user_id = ?`)
      .get(userId) as AccessRequestRow | null
    return row ? toAccessRequest(row) : null
  }

  async createAccessRequest(userId: string): Promise<AccessRequestCreation> {
    const existing = await this.getAccessRequest(userId)
    if (existing) return { request: existing, created: false }
    const request: StoredAccessRequest = {
      id: crypto.randomUUID(),
      userId,
      status: "pending",
      requestedAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
      notificationStatus: "not_configured",
      notificationAttemptedAt: null,
    }
    try {
      this.db
        .query(
          `INSERT INTO access_requests (id, user_id, status, requested_at, notification_status) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          request.id,
          userId,
          request.status,
          request.requestedAt,
          request.notificationStatus
        )
    } catch {
      const concurrent = await this.getAccessRequest(userId)
      if (concurrent) return { request: concurrent, created: false }
      throw new Error("failed to create access request")
    }
    return { request, created: true }
  }

  async setAccessRequestNotification(
    userId: string,
    status: StoredAccessRequest["notificationStatus"]
  ): Promise<void> {
    this.db
      .query(
        `UPDATE access_requests SET notification_status = ?, notification_attempted_at = ? WHERE user_id = ?`
      )
      .run(status, Date.now(), userId)
  }

  private adminRequest(row: AccessRequestRow): AdminAccessRequest {
    const user = this.db
      .query(`SELECT display_name FROM users WHERE id = ?`)
      .get(row.user_id) as { display_name: string } | null
    const identity = this.db
      .query(
        `SELECT provider, provider_login FROM identities WHERE user_id = ? ORDER BY created_at LIMIT 1`
      )
      .get(row.user_id) as {
      provider: string
      provider_login: string | null
    } | null
    const request = toAccessRequest(row)
    return {
      ...request,
      displayName: user?.display_name ?? "Deleted user",
      identity: identity?.provider_login
        ? `${identity.provider}:${identity.provider_login}`
        : null,
    }
  }

  async listAdminRequests(): Promise<AdminAccessRequest[]> {
    const rows = this.db
      .query(
        `SELECT * FROM access_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at ASC`
      )
      .all() as AccessRequestRow[]
    return rows.map((row) => this.adminRequest(row))
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    const users = this.db
      .query(`SELECT * FROM users ORDER BY updated_at DESC`)
      .all() as UserRow[]
    const storageRows = this.db
      .query(
        `SELECT user_id,
                COUNT(*) AS activity_count,
                SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS public_activity_count,
                COALESCE(SUM(size_bytes), 0) AS activity_size_bytes
           FROM activities
          GROUP BY user_id`
      )
      .all() as Array<AdminUserStorageRow & { user_id: string }>
    const storageByUserId = new Map(
      storageRows.map((row) => [row.user_id, row])
    )
    return users.map((row) => {
      const user = toUser(row)
      const storage = storageByUserId.get(user.id)
      const identity = this.db
        .query(
          `SELECT provider, provider_login FROM identities WHERE user_id = ? ORDER BY created_at LIMIT 1`
        )
        .get(user.id) as {
        provider: string
        provider_login: string | null
      } | null
      const request = this.db
        .query(`SELECT * FROM access_requests WHERE user_id = ?`)
        .get(user.id) as AccessRequestRow | null
      return {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        handle: user.handle,
        status: user.status,
        updatedAt: user.updatedAt,
        identity: identity?.provider_login
          ? `${identity.provider}:${identity.provider_login}`
          : null,
        request: request ? this.adminRequest(request) : null,
        storage: {
          activityCount: storage?.activity_count ?? 0,
          publicActivityCount: storage?.public_activity_count ?? 0,
          activitySizeBytes: storage?.activity_size_bytes ?? 0,
        },
      }
    })
  }

  async decideAccessRequest(
    requestId: string,
    decision: "approve" | "reject",
    adminUserId: string
  ): Promise<StoredAccessRequest | null> {
    const row = this.db
      .query(`SELECT * FROM access_requests WHERE id = ?`)
      .get(requestId) as AccessRequestRow | null
    if (!row) return null
    const status = decision === "approve" ? "approved" : "rejected"
    const userStatus = decision === "approve" ? "allowed" : "blocked"
    const decidedAt = Date.now()
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE access_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`
        )
        .run(status, decidedAt, adminUserId, requestId)
      this.db
        .query(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
        .run(userStatus, decidedAt, row.user_id)
    })()
    return this.getAccessRequest(row.user_id)
  }

  async getSetting(key: string): Promise<string | null> {
    return (
      (
        this.db
          .query(`SELECT value FROM server_settings WHERE key = ?`)
          .get(key) as { value: string } | null
      )?.value ?? null
    )
  }

  async setSetting(
    key: string,
    value: string | null,
    updatedBy: string
  ): Promise<void> {
    if (value === null) {
      this.db.query(`DELETE FROM server_settings WHERE key = ?`).run(key)
      return
    }
    this.db
      .query(
        `INSERT INTO server_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(key, value, Date.now(), updatedBy)
  }

  // ── sessions ────────────────────────────────────────────────────────────

  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): Promise<void> {
    const now = Date.now()
    this.db
      .query(
        `INSERT OR REPLACE INTO sessions
           (token_hash, user_id, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(tokenHash, userId, now, expiresAt, now)
  }

  async findSession(tokenHash: string): Promise<Session | null> {
    const row = this.db
      .query(`SELECT * FROM sessions WHERE token_hash = ?`)
      .get(tokenHash) as SessionRow | null
    return row ? toSession(row) : null
  }

  async touchSession(tokenHash: string, lastUsedAt: number): Promise<void> {
    this.db
      .query(`UPDATE sessions SET last_used_at = ? WHERE token_hash = ?`)
      .run(lastUsedAt, tokenHash)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.query(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash)
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    this.db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId)
  }

  async findSessionsForUser(userId: string): Promise<Session[]> {
    const rows = this.db
      .query(
        `SELECT token_hash, user_id, created_at, expires_at, last_used_at
         FROM sessions WHERE user_id = ? ORDER BY created_at ASC`
      )
      .all(userId) as SessionRow[]
    return rows.map(toSession)
  }

  // ── activities ──────────────────────────────────────────────────────────────

  async listManifest(
    userId: string,
    sinceCursor: number
  ): Promise<ManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0

    const activityPage = await pageStream<Pageable & { meta: ActivityMeta }>(
      (from, limit) => {
        const rows = this.db
          .query(
            `SELECT content_hash, name, is_public, format, activity_type, start_sun_phase, started_at_ms, distance_km,
                    point_count, size_bytes, updated_at,
                    duration_ms, moving_time_ms, elevation_gain_m, avg_moving_speed_kmh
               FROM activities
              WHERE user_id = ? AND updated_at >= ?
              ORDER BY updated_at ASC, content_hash ASC
              LIMIT ?`
          )
          .all(userId, from, limit) as ActivityRow[]
        return rows.map((row) => ({
          time: row.updated_at,
          contentHash: row.content_hash,
          meta: toMeta(row),
        }))
      },
      since,
      SYNC_PAGE_SIZE
    )

    const tombstonePage = await pageStream<
      Pageable & { tombstone: ActivityTombstone }
    >(
      (from, limit) => {
        const rows = this.db
          .query(
            `SELECT content_hash, deleted_at
               FROM activity_tombstones
              WHERE user_id = ? AND deleted_at >= ?
              ORDER BY deleted_at ASC, content_hash ASC
              LIMIT ?`
          )
          .all(userId, from, limit) as TombstoneRow[]
        return rows.map((row) => ({
          time: row.deleted_at,
          contentHash: row.content_hash,
          tombstone: {
            contentHash: row.content_hash,
            deletedAt: row.deleted_at,
          },
        }))
      },
      since,
      SYNC_PAGE_SIZE
    )

    const { cursor, hasMore } = combineCursors(since, [
      activityPage,
      tombstonePage,
    ])

    return {
      activities: activityPage.rows.map((row) => row.meta),
      deletions: tombstonePage.rows.map((row) => row.tombstone),
      cursor,
      hasMore,
    }
  }

  async putActivity(
    userId: string,
    meta: ActivityMeta,
    blob: Uint8Array
  ): Promise<void> {
    const path = blobPath(this.dataDir, userId, meta.contentHash)
    await Bun.write(path, blob)

    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO activities
             (user_id, content_hash, name, is_public, format, activity_type, start_sun_phase, started_at_ms, distance_km,
              point_count, size_bytes, blob_ref, created_at, updated_at,
              duration_ms, moving_time_ms, elevation_gain_m, avg_moving_speed_kmh)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, content_hash) DO UPDATE SET
             name = excluded.name,
             is_public = excluded.is_public,
             format = excluded.format,
             activity_type = excluded.activity_type,
             start_sun_phase = excluded.start_sun_phase,
             started_at_ms = excluded.started_at_ms,
             distance_km = excluded.distance_km,
             point_count = excluded.point_count,
             size_bytes = excluded.size_bytes,
             blob_ref = excluded.blob_ref,
             updated_at = excluded.updated_at,
             duration_ms = excluded.duration_ms,
             moving_time_ms = excluded.moving_time_ms,
             elevation_gain_m = excluded.elevation_gain_m,
             avg_moving_speed_kmh = excluded.avg_moving_speed_kmh`
        )
        .run(
          userId,
          meta.contentHash,
          meta.name,
          meta.isPublic ? 1 : 0,
          meta.format,
          meta.activityType ?? null,
          meta.startSunPhase ?? null,
          meta.startedAtMs,
          meta.distanceKm,
          meta.pointCount,
          meta.sizeBytes,
          path,
          now,
          meta.updatedAt,
          meta.durationMs,
          meta.movingTimeMs,
          meta.elevationGainM,
          meta.avgMovingSpeedKmh
        )
      // Re-uploading a previously deleted activity resurrects it; leaving the
      // tombstone would make the manifest tell the client to delete it again.
      this.db
        .query(
          `DELETE FROM activity_tombstones WHERE user_id = ? AND content_hash = ?`
        )
        .run(userId, meta.contentHash)
    })()
  }

  async getActivity(
    userId: string,
    contentHash: string
  ): Promise<ActivityMeta | null> {
    if (!isSafeContentHash(contentHash)) return null
    const row = this.db
      .query(
        `SELECT content_hash, name, is_public, format, activity_type, start_sun_phase, started_at_ms, distance_km,
                point_count, size_bytes, updated_at,
                duration_ms, moving_time_ms, elevation_gain_m, avg_moving_speed_kmh
           FROM activities WHERE user_id = ? AND content_hash = ?`
      )
      .get(userId, contentHash) as ActivityRow | null
    return row ? toMeta(row) : null
  }

  async setActivityVisibility(
    userId: string,
    contentHash: string,
    isPublic: boolean
  ): Promise<ActivityMeta | null> {
    if (!isSafeContentHash(contentHash)) return null
    const now = Date.now()
    this.db
      .query(
        `UPDATE activities SET is_public = ?, updated_at = ?
          WHERE user_id = ? AND content_hash = ?`
      )
      .run(isPublic ? 1 : 0, now, userId, contentHash)
    return this.getActivity(userId, contentHash)
  }

  async getActivityBlob(
    userId: string,
    contentHash: string
  ): Promise<Uint8Array | null> {
    // The row lookup is the authorisation check: a hash that belongs to
    // another user never reaches the filesystem.
    const meta = await this.getActivity(userId, contentHash)
    if (!meta) return null

    const file = Bun.file(blobPath(this.dataDir, userId, contentHash))
    if (!(await file.exists())) return null
    return new Uint8Array(await file.arrayBuffer())
  }

  async deleteActivity(userId: string, contentHash: string): Promise<number> {
    const now = Date.now()
    if (!isSafeContentHash(contentHash)) return now

    this.db.transaction(() => {
      this.db
        .query(`DELETE FROM activities WHERE user_id = ? AND content_hash = ?`)
        .run(userId, contentHash)
      this.db
        .query(
          `INSERT INTO activity_tombstones (user_id, content_hash, deleted_at)
           VALUES (?, ?, ?)
           ON CONFLICT (user_id, content_hash) DO UPDATE SET
             deleted_at = excluded.deleted_at`
        )
        .run(userId, contentHash, now)
    })()

    await Bun.file(blobPath(this.dataDir, userId, contentHash))
      .delete()
      .catch(() => {})
    return now
  }

  async purgeActivities(userId: string): Promise<number> {
    const rows = this.db
      .query(`SELECT content_hash FROM activities WHERE user_id = ?`)
      .all(userId) as { content_hash: string }[]

    // No tombstone writes — see the interface docs. This wipes the server's
    // copy only; other devices keep their activities and their cached view.
    this.db.query(`DELETE FROM activities WHERE user_id = ?`).run(userId)

    for (const row of rows) {
      if (!isSafeContentHash(row.content_hash)) continue
      await Bun.file(blobPath(this.dataDir, userId, row.content_hash))
        .delete()
        .catch(() => {})
    }
    return rows.length
  }

  async listAllActivitiesForUser(userId: string): Promise<Array<any>> {
    const rows = this.db
      .query(
        `SELECT content_hash, name, is_public, format, activity_type, start_sun_phase, started_at_ms, distance_km,
                point_count, size_bytes, updated_at,
                duration_ms, moving_time_ms, elevation_gain_m, avg_moving_speed_kmh
           FROM activities WHERE user_id = ? ORDER BY updated_at ASC`
      )
      .all(userId) as ActivityRow[]

    const activities: any[] = []

    for (const row of rows) {
      const meta = toMeta(row)
      if (!isSafeContentHash(row.content_hash)) continue

      // Fetch and decompress the blob
      const file = Bun.file(blobPath(this.dataDir, userId, row.content_hash))
      if (!(await file.exists())) continue

      try {
        const compressed = new Uint8Array(await file.arrayBuffer())
        const decompressed = Bun.gunzipSync(compressed)
        const json = new TextDecoder().decode(decompressed)
        const activityData = JSON.parse(json)

        // Add the content hash as id (for export purposes)
        activities.push({
          ...activityData,
          id: row.content_hash,
        })
      } catch (err) {
        // Skip activities that can't be decompressed or parsed
        console.error(
          `[export] Failed to decompress activity ${row.content_hash}:`,
          err
        )
      }
    }

    return activities
  }

  async listSavedPointsManifest(userId: string, sinceCursor: number): Promise<SavedPointManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0
    const pointRows = this.db.query(`SELECT id, longitude, latitude, name, description, colour, is_public, created_at, updated_at FROM saved_points WHERE user_id = ? AND updated_at >= ? ORDER BY updated_at ASC, id ASC LIMIT ?`).all(userId, since, SYNC_PAGE_SIZE) as SavedPointRow[]
    const deletionRows = this.db.query(`SELECT id, deleted_at FROM saved_point_tombstones WHERE user_id = ? AND deleted_at >= ? ORDER BY deleted_at ASC, id ASC LIMIT ?`).all(userId, since, SYNC_PAGE_SIZE) as SavedPointTombstoneRow[]
    const savedPoints = pointRows.map(toSavedPoint)
    const deletions = deletionRows.map((row): SavedPointTombstone => ({ id: row.id, deletedAt: row.deleted_at }))
    const cursor = Math.max(since, ...savedPoints.map((point) => point.updatedAt), ...deletions.map((tombstone) => tombstone.deletedAt))
    return { savedPoints, deletions, cursor, hasMore: savedPoints.length === SYNC_PAGE_SIZE || deletions.length === SYNC_PAGE_SIZE }
  }

  async listSavedPoints(userId: string): Promise<SavedPoint[]> {
    const rows = this.db.query(`SELECT id, longitude, latitude, name, description, colour, is_public, created_at, updated_at FROM saved_points WHERE user_id = ? ORDER BY updated_at DESC, id ASC`).all(userId) as SavedPointRow[]
    return rows.map(toSavedPoint)
  }

  async upsertSavedPoint(userId: string, point: SavedPoint): Promise<SavedPoint> {
    const existing = this.db.query(`SELECT created_at FROM saved_points WHERE user_id = ? AND id = ?`).get(userId, point.id) as { created_at: number } | null
    const updatedAt = Date.now()
    const createdAt = existing?.created_at ?? point.createdAt
    this.db.transaction(() => {
      this.db.query(`INSERT INTO saved_points (user_id, id, longitude, latitude, name, description, colour, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET longitude = excluded.longitude, latitude = excluded.latitude, name = excluded.name, description = excluded.description, colour = excluded.colour, is_public = excluded.is_public, updated_at = excluded.updated_at`).run(userId, point.id, point.lng, point.lat, point.name, point.description, point.color, point.isPublic ? 1 : 0, createdAt, updatedAt)
      this.db.query(`DELETE FROM saved_point_tombstones WHERE user_id = ? AND id = ?`).run(userId, point.id)
    })()
    return { ...point, createdAt, updatedAt }
  }

  async deleteSavedPoint(userId: string, id: string): Promise<number> {
    const deletedAt = Date.now()
    this.db.transaction(() => {
      this.db.query(`DELETE FROM saved_points WHERE user_id = ? AND id = ?`).run(userId, id)
      this.db.query(`INSERT INTO saved_point_tombstones (user_id, id, deleted_at) VALUES (?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET deleted_at = excluded.deleted_at`).run(userId, id, deletedAt)
    })()
    return deletedAt
  }

  async listAllSavedPointsForUser(userId: string): Promise<SavedPoint[]> { return this.listSavedPoints(userId) }

  async listPublicSavedPoints(userId: string): Promise<SavedPoint[]> {
    const rows = this.db.query(`SELECT id, longitude, latitude, name, description, colour, is_public, created_at, updated_at FROM saved_points WHERE user_id = ? AND is_public = 1 ORDER BY updated_at DESC, id ASC`).all(userId) as SavedPointRow[]
    return rows.map(toSavedPoint)
  }

  async findUserByHandle(handle: string): Promise<User | null> {
    const row = this.db
      .query(`SELECT * FROM users WHERE handle = ? COLLATE NOCASE`)
      .get(handle) as UserRow | null
    return row ? toUser(row) : null
  }

  async listPublicActivities(userId: string): Promise<PublicProfileResponse> {
    const user = await this.getUser(userId)
    if (!user || !user.handle) {
      return {
        user: {
          handle: user?.handle ?? "",
          displayName: user?.displayName ?? "",
          avatarUrl: user?.avatarUrl ?? null,
        },
        activities: [],
        savedPoints: [],
      }
    }

    const rows = this.db
      .query(
        `SELECT t.content_hash, t.name, t.is_public, t.format, t.activity_type, t.start_sun_phase, t.started_at_ms,
                t.distance_km, t.point_count, t.size_bytes, t.updated_at,
                t.duration_ms, t.moving_time_ms, t.elevation_gain_m, t.avg_moving_speed_kmh
           FROM activities t
          WHERE t.user_id = ? AND t.is_public = 1
          ORDER BY (t.started_at_ms IS NULL), t.started_at_ms DESC, t.updated_at DESC`
      )
      .all(userId) as ActivityRow[]

    // Stats are denormalized onto new rows. Old uploads predate those columns,
    // so hydrate each legacy row once from its already-stored upload payload.
    const activities = await Promise.all(
      rows.map((row) => this.hydrateLegacyPublicMeta(userId, row))
    )

    return {
      user: {
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      activities,
      savedPoints: await this.listPublicSavedPoints(userId),
    }
  }

  private async hydrateLegacyPublicMeta(
    userId: string,
    row: ActivityRow
  ): Promise<PublicActivityMeta> {
    if (
      row.duration_ms !== null ||
      row.moving_time_ms !== null ||
      row.avg_moving_speed_kmh !== null
    ) {
      return toMeta(row)
    }

    try {
      const file = Bun.file(blobPath(this.dataDir, userId, row.content_hash))
      const compressed = new Uint8Array(await file.arrayBuffer())
      const payload = JSON.parse(
        new TextDecoder().decode(Bun.gunzipSync(compressed))
      )
      const parsed = parseActivityUpload(payload)
      if (!parsed.ok) return toMeta(row)

      const { stats } = parsed.activity
      this.db
        .query(
          `UPDATE activities
              SET duration_ms = ?, moving_time_ms = ?, elevation_gain_m = ?,
                  avg_moving_speed_kmh = ?
            WHERE user_id = ? AND content_hash = ?`
        )
        .run(
          stats.durationMs,
          stats.movingTimeMs,
          stats.elevationGainM,
          stats.avgMovingSpeedKmh,
          userId,
          row.content_hash
        )

      return {
        ...toMeta(row),
        durationMs: stats.durationMs,
        movingTimeMs: stats.movingTimeMs,
        elevationGainM: stats.elevationGainM,
        avgMovingSpeedKmh: stats.avgMovingSpeedKmh,
      }
    } catch (err) {
      console.warn(
        `[public-profile] failed to hydrate metadata for ${row.content_hash}:`,
        err
      )
      return toMeta(row)
    }
  }

  close(): void {
    this.db.close()
  }
}

/** Opens (creating if needed) the database and applies the schema. */
export async function createSqliteFsStore(
  dataDir: string
): Promise<SqliteFsStore> {
  const dir = stripTrailingSlash(dataDir)
  // Bun.write creates missing parent directories; this is the cheapest way to
  // guarantee DATA_DIR exists before bun:sqlite opens a file inside it.
  await Bun.write(`${dir}/.keep`, "")

  const db = new Database(`${dir}/fogofwalk.db`, { create: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec("PRAGMA busy_timeout = 5000;")

  migrateSchema(db)

  const schemaUrl = new URL("../schema/001_init.sql", import.meta.url)
  const schema = await Bun.file(schemaUrl).text()
  db.exec(schema)

  return new SqliteFsStore(db, dir)
}
