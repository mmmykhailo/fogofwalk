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
  ManifestPage,
  TrackMeta,
  TrackTombstone,
  UserStatus,
} from "~shared/api"
import { SYNC_PAGE_SIZE } from "~shared/constants"
import type { TrackFormat } from "~shared/tracks"

import { combineCursors, pageStream } from "./manifestPaging"
import type { Pageable } from "./manifestPaging"
import type {
  Identity,
  IdentityInput,
  ServerStore,
  Session,
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

interface UserRow {
  id: string
  display_name: string
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

interface TrackRow {
  content_hash: string
  name: string
  format: string
  started_at_ms: number | null
  distance_km: number
  point_count: number
  size_bytes: number
  updated_at: number
}

interface TombstoneRow {
  content_hash: string
  deleted_at: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
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

function toMeta(row: TrackRow): TrackMeta {
  return {
    contentHash: row.content_hash,
    name: row.name,
    format: row.format as TrackFormat,
    startedAtMs: row.started_at_ms,
    distanceKm: row.distance_km,
    pointCount: row.point_count,
    sizeBytes: row.size_bytes,
    updatedAt: row.updated_at,
  }
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
        `INSERT INTO users (id, display_name, avatar_url, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, input.displayName, input.avatarUrl, now, now)
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
      this.db
        .query(`DELETE FROM track_tombstones WHERE user_id = ?`)
        .run(userId)
      this.db.query(`DELETE FROM tracks WHERE user_id = ?`).run(userId)
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

  // ── tracks ──────────────────────────────────────────────────────────────

  async listManifest(
    userId: string,
    sinceCursor: number
  ): Promise<ManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0

    const trackPage = await pageStream<Pageable & { meta: TrackMeta }>(
      (from, limit) => {
        const rows = this.db
          .query(
            `SELECT content_hash, name, format, started_at_ms, distance_km,
                    point_count, size_bytes, updated_at
               FROM tracks
              WHERE user_id = ? AND updated_at >= ?
              ORDER BY updated_at ASC, content_hash ASC
              LIMIT ?`
          )
          .all(userId, from, limit) as TrackRow[]
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
      Pageable & { tombstone: TrackTombstone }
    >(
      (from, limit) => {
        const rows = this.db
          .query(
            `SELECT content_hash, deleted_at
               FROM track_tombstones
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
      trackPage,
      tombstonePage,
    ])

    return {
      tracks: trackPage.rows.map((row) => row.meta),
      deletions: tombstonePage.rows.map((row) => row.tombstone),
      cursor,
      hasMore,
    }
  }

  async putTrack(
    userId: string,
    meta: TrackMeta,
    blob: Uint8Array
  ): Promise<void> {
    const path = blobPath(this.dataDir, userId, meta.contentHash)
    await Bun.write(path, blob)

    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO tracks
             (user_id, content_hash, name, format, started_at_ms, distance_km,
              point_count, size_bytes, blob_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, content_hash) DO UPDATE SET
             name = excluded.name,
             format = excluded.format,
             started_at_ms = excluded.started_at_ms,
             distance_km = excluded.distance_km,
             point_count = excluded.point_count,
             size_bytes = excluded.size_bytes,
             blob_ref = excluded.blob_ref,
             updated_at = excluded.updated_at`
        )
        .run(
          userId,
          meta.contentHash,
          meta.name,
          meta.format,
          meta.startedAtMs,
          meta.distanceKm,
          meta.pointCount,
          meta.sizeBytes,
          path,
          now,
          meta.updatedAt
        )
      // Re-uploading a previously deleted track resurrects it; leaving the
      // tombstone would make the manifest tell the client to delete it again.
      this.db
        .query(
          `DELETE FROM track_tombstones WHERE user_id = ? AND content_hash = ?`
        )
        .run(userId, meta.contentHash)
    })()
  }

  async getTrack(
    userId: string,
    contentHash: string
  ): Promise<TrackMeta | null> {
    if (!isSafeContentHash(contentHash)) return null
    const row = this.db
      .query(
        `SELECT content_hash, name, format, started_at_ms, distance_km,
                point_count, size_bytes, updated_at
           FROM tracks WHERE user_id = ? AND content_hash = ?`
      )
      .get(userId, contentHash) as TrackRow | null
    return row ? toMeta(row) : null
  }

  async getTrackBlob(
    userId: string,
    contentHash: string
  ): Promise<Uint8Array | null> {
    // The row lookup is the authorisation check: a hash that belongs to
    // another user never reaches the filesystem.
    const meta = await this.getTrack(userId, contentHash)
    if (!meta) return null

    const file = Bun.file(blobPath(this.dataDir, userId, contentHash))
    if (!(await file.exists())) return null
    return new Uint8Array(await file.arrayBuffer())
  }

  async deleteTrack(userId: string, contentHash: string): Promise<number> {
    const now = Date.now()
    if (!isSafeContentHash(contentHash)) return now

    this.db.transaction(() => {
      this.db
        .query(`DELETE FROM tracks WHERE user_id = ? AND content_hash = ?`)
        .run(userId, contentHash)
      this.db
        .query(
          `INSERT INTO track_tombstones (user_id, content_hash, deleted_at)
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

  async purgeTracks(userId: string): Promise<number> {
    const rows = this.db
      .query(`SELECT content_hash FROM tracks WHERE user_id = ?`)
      .all(userId) as { content_hash: string }[]

    // No tombstone writes — see the interface docs. This wipes the server's
    // copy only; other devices keep their tracks and their cached view.
    this.db.query(`DELETE FROM tracks WHERE user_id = ?`).run(userId)

    for (const row of rows) {
      if (!isSafeContentHash(row.content_hash)) continue
      await Bun.file(blobPath(this.dataDir, userId, row.content_hash))
        .delete()
        .catch(() => {})
    }
    return rows.length
  }

  async listAllTracksForUser(userId: string): Promise<Array<any>> {
    const rows = this.db
      .query(
        `SELECT content_hash, name, format, started_at_ms, distance_km,
                point_count, size_bytes, updated_at
           FROM tracks WHERE user_id = ? ORDER BY updated_at ASC`
      )
      .all(userId) as TrackRow[]

    const tracks: any[] = []

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
        const trackData = JSON.parse(json)

        // Add the content hash as id (for export purposes)
        tracks.push({
          ...trackData,
          id: row.content_hash,
        })
      } catch (err) {
        // Skip tracks that can't be decompressed or parsed
        console.error(
          `[export] Failed to decompress track ${row.content_hash}:`,
          err
        )
      }
    }

    return tracks
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

  const schemaUrl = new URL("../schema/001_init.sql", import.meta.url)
  const schema = await Bun.file(schemaUrl).text()
  db.exec(schema)

  return new SqliteFsStore(db, dir)
}
