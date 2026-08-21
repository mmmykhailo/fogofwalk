/**
 * In-process driver. Exists for `bun test` — it holds everything in Maps and
 * loses it on exit. Never select it in production; `STORE_DRIVER=memory` would
 * silently discard every upload.
 *
 * It implements the same paging helper as `sqlite-fs`, so a manifest cursor
 * bug shows up in tests rather than only against a real database.
 */

import type {
  ManifestPage,
  PublicProfileResponse,
  PublicTrackMeta,
  TrackMeta,
  TrackTombstone,
  UserStatus,
} from "~shared/api"
import { SYNC_PAGE_SIZE } from "~shared/constants"

import { combineCursors, comparePageable, pageStream } from "./manifestPaging"
import type { Pageable } from "./manifestPaging"
import type {
  Identity,
  IdentityInput,
  ServerStore,
  Session,
  User,
} from "./types"

interface StoredTrack {
  meta: TrackMeta
  blob: Uint8Array
  createdAt: number
}

const identityKey = (provider: string, providerUserId: string): string =>
  `${provider}:${providerUserId}`

export class MemoryStore implements ServerStore {
  private readonly users = new Map<string, User>()
  private readonly identities = new Map<string, Identity>()
  private readonly sessions = new Map<string, Session>()
  /** userId → contentHash → track */
  private readonly tracks = new Map<string, Map<string, StoredTrack>>()
  /** userId → contentHash → deletedAt */
  private readonly tombstones = new Map<string, Map<string, number>>()

  // ── users & identities ──────────────────────────────────────────────────

  async findUserByIdentity(
    provider: string,
    providerUserId: string
  ): Promise<User | null> {
    const identity = this.identities.get(identityKey(provider, providerUserId))
    if (!identity) return null
    return this.users.get(identity.userId) ?? null
  }

  async upsertUserFromIdentity(input: IdentityInput): Promise<User> {
    const now = Date.now()
    const key = identityKey(input.provider, input.providerUserId)
    const existingIdentity = this.identities.get(key)

    if (existingIdentity) {
      this.identities.set(key, {
        ...existingIdentity,
        providerLogin: input.login,
        email: input.email,
      })
      const user = this.users.get(existingIdentity.userId)
      if (!user) throw new Error("identity points at a missing user")
      // Mirrors sqlite-fs: handle is claimed once and never overwritten by a
      // later sign-in, so a login that collides with another user's handle
      // is silently ignored rather than clobbering an existing handle.
      const handle = user.handle ?? this.claimHandle(input.login, user.id)
      const updated: User = {
        ...user,
        displayName: input.displayName,
        handle,
        avatarUrl: input.avatarUrl,
        updatedAt: now,
      }
      this.users.set(user.id, updated)
      return updated
    }

    const newUserId = crypto.randomUUID()
    const user: User = {
      id: newUserId,
      displayName: input.displayName,
      handle: this.claimHandle(input.login, newUserId),
      avatarUrl: input.avatarUrl,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }
    this.users.set(user.id, user)
    this.identities.set(key, {
      provider: input.provider,
      providerUserId: input.providerUserId,
      userId: user.id,
      providerLogin: input.login,
      email: input.email,
      createdAt: now,
    })
    return user
  }

  /** Returns `login` if no other user already holds it, otherwise `null`. */
  private claimHandle(login: string, ownerId: string): string | null {
    for (const other of this.users.values()) {
      if (
        other.id !== ownerId &&
        other.handle?.toLowerCase() === login.toLowerCase()
      ) {
        return null
      }
    }
    return login
  }

  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null
  }

  async setUserStatus(
    userId: string,
    status: UserStatus
  ): Promise<User | null> {
    const user = this.users.get(userId)
    if (!user) return null
    const updated: User = { ...user, status, updatedAt: Date.now() }
    this.users.set(userId, updated)
    return updated
  }

  async findPrimaryIdentity(userId: string): Promise<Identity | null> {
    let primary: Identity | null = null
    for (const identity of this.identities.values()) {
      if (identity.userId !== userId) continue
      if (!primary || identity.createdAt < primary.createdAt) primary = identity
    }
    return primary
  }

  async findIdentitiesForUser(userId: string): Promise<Identity[]> {
    const identities: Identity[] = []
    for (const identity of this.identities.values()) {
      if (identity.userId === userId) identities.push(identity)
    }
    return identities.sort((a, b) => a.createdAt - b.createdAt)
  }

  async deleteUser(userId: string): Promise<void> {
    this.users.delete(userId)
    for (const [key, identity] of this.identities) {
      if (identity.userId === userId) this.identities.delete(key)
    }
    for (const [hash, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(hash)
    }
    this.tracks.delete(userId)
    this.tombstones.delete(userId)
  }

  // ── sessions ────────────────────────────────────────────────────────────

  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): Promise<void> {
    const now = Date.now()
    this.sessions.set(tokenHash, {
      tokenHash,
      userId,
      createdAt: now,
      expiresAt,
      lastUsedAt: now,
    })
  }

  async findSession(tokenHash: string): Promise<Session | null> {
    return this.sessions.get(tokenHash) ?? null
  }

  async touchSession(tokenHash: string, lastUsedAt: number): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session) this.sessions.set(tokenHash, { ...session, lastUsedAt })
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    for (const [hash, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(hash)
    }
  }

  async findSessionsForUser(userId: string): Promise<Session[]> {
    const sessions: Session[] = []
    for (const session of this.sessions.values()) {
      if (session.userId === userId) sessions.push(session)
    }
    return sessions.sort((a, b) => a.createdAt - b.createdAt)
  }

  // ── tracks ──────────────────────────────────────────────────────────────

  async listManifest(
    userId: string,
    sinceCursor: number
  ): Promise<ManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0

    const trackRows: (Pageable & { meta: TrackMeta })[] = [
      ...(this.tracks.get(userId)?.values() ?? []),
    ]
      .map((stored) => ({
        time: stored.meta.updatedAt,
        contentHash: stored.meta.contentHash,
        meta: stored.meta,
      }))
      .sort(comparePageable)

    const tombstoneRows: (Pageable & { tombstone: TrackTombstone })[] = [
      ...(this.tombstones.get(userId)?.entries() ?? []),
    ]
      .map(([contentHash, deletedAt]) => ({
        time: deletedAt,
        contentHash,
        tombstone: { contentHash, deletedAt },
      }))
      .sort(comparePageable)

    const slice =
      <T extends Pageable>(rows: T[]) =>
      (from: number, limit: number): T[] =>
        rows.filter((row) => row.time >= from).slice(0, limit)

    const trackPage = await pageStream(slice(trackRows), since, SYNC_PAGE_SIZE)
    const tombstonePage = await pageStream(
      slice(tombstoneRows),
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
    let byHash = this.tracks.get(userId)
    if (!byHash) {
      byHash = new Map<string, StoredTrack>()
      this.tracks.set(userId, byHash)
    }
    const existing = byHash.get(meta.contentHash)
    byHash.set(meta.contentHash, {
      meta,
      blob,
      createdAt: existing?.createdAt ?? Date.now(),
    })
    this.tombstones.get(userId)?.delete(meta.contentHash)
  }

  async getTrack(
    userId: string,
    contentHash: string
  ): Promise<TrackMeta | null> {
    return this.tracks.get(userId)?.get(contentHash)?.meta ?? null
  }

  async getTrackBlob(
    userId: string,
    contentHash: string
  ): Promise<Uint8Array | null> {
    return this.tracks.get(userId)?.get(contentHash)?.blob ?? null
  }

  async setTrackVisibility(
    userId: string,
    contentHash: string,
    isPublic: boolean
  ): Promise<TrackMeta | null> {
    const stored = this.tracks.get(userId)?.get(contentHash)
    if (!stored) return null
    stored.meta = { ...stored.meta, isPublic }
    return stored.meta
  }

  async deleteTrack(userId: string, contentHash: string): Promise<number> {
    this.tracks.get(userId)?.delete(contentHash)
    let byHash = this.tombstones.get(userId)
    if (!byHash) {
      byHash = new Map<string, number>()
      this.tombstones.set(userId, byHash)
    }
    const deletedAt = Date.now()
    byHash.set(contentHash, deletedAt)
    return deletedAt
  }

  async purgeTracks(userId: string): Promise<number> {
    const tracks = this.tracks.get(userId)
    const count = tracks?.size ?? 0
    // No tombstones — see the interface docs.
    tracks?.clear()
    return count
  }

  async listAllTracksForUser(userId: string): Promise<Array<any>> {
    const userTracks = this.tracks.get(userId)
    if (!userTracks) return []

    const tracks: any[] = []
    for (const stored of userTracks.values()) {
      try {
        // Decompress the gzipped blob
        const decompressed = Bun.gunzipSync(
          stored.blob as Uint8Array<ArrayBuffer>
        )
        const json = new TextDecoder().decode(decompressed)
        const trackData = JSON.parse(json)
        tracks.push({
          ...trackData,
          id: stored.meta.contentHash,
        })
      } catch (err) {
        console.error(
          `[export] Failed to parse track ${stored.meta.contentHash}:`,
          err
        )
      }
    }

    return tracks.sort(
      (a, b) => (a.startedAtMs ?? Infinity) - (b.startedAtMs ?? Infinity)
    )
  }

  async findUserByHandle(handle: string): Promise<User | null> {
    const lower = handle.toLowerCase()
    for (const user of this.users.values()) {
      if (user.handle?.toLowerCase() === lower) return user
    }
    return null
  }

  async listPublicTracks(userId: string): Promise<PublicProfileResponse> {
    const user = await this.getUser(userId)
    if (!user || !user.handle) {
      return {
        user: {
          handle: user?.handle ?? "",
          displayName: user?.displayName ?? "",
          avatarUrl: user?.avatarUrl ?? null,
        },
        tracks: [],
      }
    }

    const userTracks = this.tracks.get(userId)
    const tracks: PublicTrackMeta[] = []

    if (userTracks) {
      for (const stored of userTracks.values()) {
        if (!stored.meta.isPublic) continue
        // Stats are denormalized onto `meta` at upload time (see putTrack),
        // so this never needs to decompress/parse the stored blob.
        tracks.push({ ...stored.meta })
      }
    }

    tracks.sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0))

    return {
      user: {
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      tracks,
    }
  }

  close(): void {
    this.users.clear()
    this.identities.clear()
    this.sessions.clear()
    this.tracks.clear()
    this.tombstones.clear()
  }
}

export function createMemoryStore(): MemoryStore {
  return new MemoryStore()
}
