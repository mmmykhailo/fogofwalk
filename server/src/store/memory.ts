/**
 * In-process driver. Exists for `bun test` — it holds everything in Maps and
 * loses it on exit. Never select it in production; `STORE_DRIVER=memory` would
 * silently discard every upload.
 *
 * It implements the same paging helper as `sqlite-fs`, so a manifest cursor
 * bug shows up in tests rather than only against a real database.
 */

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
import type { SavedPoint } from "~shared/saved-points"
import { SYNC_PAGE_SIZE } from "~shared/constants"

import { combineCursors, comparePageable, pageStream } from "./manifestPaging"
import type { Pageable } from "./manifestPaging"
import type {
  Identity,
  IdentityInput,
  ServerStore,
  Session,
  AccessRequestCreation,
  StoredAccessRequest,
  User,
} from "./types"

interface StoredActivity {
  meta: ActivityMeta
  blob: Uint8Array
  createdAt: number
}

const identityKey = (provider: string, providerUserId: string): string =>
  `${provider}:${providerUserId}`

export class MemoryStore implements ServerStore {
  private readonly users = new Map<string, User>()
  private readonly identities = new Map<string, Identity>()
  private readonly sessions = new Map<string, Session>()
  /** userId → contentHash → activity */
  private readonly activities = new Map<string, Map<string, StoredActivity>>()
  /** userId → contentHash → deletedAt */
  private readonly tombstones = new Map<string, Map<string, number>>()
  private readonly savedPoints = new Map<string, Map<string, SavedPoint>>()
  private readonly savedPointTombstones = new Map<string, Map<string, number>>()
  private readonly accessRequests = new Map<string, StoredAccessRequest>()
  private readonly settings = new Map<string, string>()

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

  async setUserStatusWithAccessRequest(
    userId: string,
    status: UserStatus,
    adminUserId: string
  ): Promise<User | null> {
    const user = await this.setUserStatus(userId, status)
    if (!user) return null
    const request = this.accessRequests.get(userId)
    if (!request) return user
    const isPending = status === "pending"
    this.accessRequests.set(userId, {
      ...request,
      status:
        status === "allowed"
          ? "approved"
          : status === "blocked"
            ? "rejected"
            : "pending",
      decidedAt: isPending ? null : Date.now(),
      decidedBy: isPending ? null : adminUserId,
    })
    return user
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
    this.activities.delete(userId)
    this.tombstones.delete(userId)
    this.savedPoints.delete(userId)
    this.savedPointTombstones.delete(userId)
    this.accessRequests.delete(userId)
  }

  async getAccessRequest(userId: string): Promise<StoredAccessRequest | null> {
    return this.accessRequests.get(userId) ?? null
  }

  async createAccessRequest(userId: string): Promise<AccessRequestCreation> {
    const existing = this.accessRequests.get(userId)
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
    this.accessRequests.set(userId, request)
    return { request, created: true }
  }

  async setAccessRequestNotification(
    userId: string,
    status: "not_configured" | "sent" | "failed"
  ): Promise<void> {
    const request = this.accessRequests.get(userId)
    if (request)
      this.accessRequests.set(userId, {
        ...request,
        notificationStatus: status,
        notificationAttemptedAt: Date.now(),
      })
  }

  private toAdminRequest(request: StoredAccessRequest): AdminAccessRequest {
    const user = this.users.get(request.userId)
    const identity = [...this.identities.values()].find(
      (item) => item.userId === request.userId
    )
    return {
      id: request.id,
      userId: request.userId,
      status: request.status,
      requestedAt: request.requestedAt,
      decidedAt: request.decidedAt,
      displayName: user?.displayName ?? "Deleted user",
      identity: identity?.providerLogin
        ? `${identity.provider}:${identity.providerLogin}`
        : null,
      notificationStatus: request.notificationStatus,
      notificationAttemptedAt: request.notificationAttemptedAt,
    }
  }

  async listAdminRequests(): Promise<AdminAccessRequest[]> {
    return [...this.accessRequests.values()]
      .map((request) => this.toAdminRequest(request))
      .sort((a, b) =>
        a.status === "pending" && b.status !== "pending"
          ? -1
          : b.status === "pending" && a.status !== "pending"
            ? 1
            : a.requestedAt - b.requestedAt
      )
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    return [...this.users.values()]
      .map((user) => {
        const identity = [...this.identities.values()].find(
          (item) => item.userId === user.id
        )
        const request = this.accessRequests.get(user.id)
        const activities = [...(this.activities.get(user.id)?.values() ?? [])]
        return {
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          handle: user.handle,
          status: user.status,
          updatedAt: user.updatedAt,
          identity: identity?.providerLogin
            ? `${identity.provider}:${identity.providerLogin}`
            : null,
          request: request ? this.toAdminRequest(request) : null,
          storage: {
            activityCount: activities.length,
            publicActivityCount: activities.filter(
              (activity) => activity.meta.isPublic
            ).length,
            activitySizeBytes: activities.reduce(
              (total, activity) => total + activity.meta.sizeBytes,
              0
            ),
          },
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async decideAccessRequest(
    requestId: string,
    decision: "approve" | "reject",
    adminUserId: string
  ): Promise<StoredAccessRequest | null> {
    const request = [...this.accessRequests.values()].find(
      (item) => item.id === requestId
    )
    if (!request) return null
    const status: StoredAccessRequest["status"] =
      decision === "approve" ? "approved" : "rejected"
    const updated = {
      ...request,
      status,
      decidedAt: Date.now(),
      decidedBy: adminUserId,
    }
    this.accessRequests.set(request.userId, updated)
    await this.setUserStatus(
      request.userId,
      decision === "approve" ? "allowed" : "blocked"
    )
    return updated
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null
  }
  async setSetting(
    key: string,
    value: string | null,
    _updatedBy: string
  ): Promise<void> {
    if (value === null) this.settings.delete(key)
    else this.settings.set(key, value)
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

  // ── activities ──────────────────────────────────────────────────────────────

  async listManifest(
    userId: string,
    sinceCursor: number
  ): Promise<ManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0

    const activityRows: (Pageable & { meta: ActivityMeta })[] = [
      ...(this.activities.get(userId)?.values() ?? []),
    ]
      .map((stored) => ({
        time: stored.meta.updatedAt,
        contentHash: stored.meta.contentHash,
        meta: stored.meta,
      }))
      .sort(comparePageable)

    const tombstoneRows: (Pageable & { tombstone: ActivityTombstone })[] = [
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

    const activityPage = await pageStream(
      slice(activityRows),
      since,
      SYNC_PAGE_SIZE
    )
    const tombstonePage = await pageStream(
      slice(tombstoneRows),
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
    let byHash = this.activities.get(userId)
    if (!byHash) {
      byHash = new Map<string, StoredActivity>()
      this.activities.set(userId, byHash)
    }
    const existing = byHash.get(meta.contentHash)
    byHash.set(meta.contentHash, {
      meta,
      blob,
      createdAt: existing?.createdAt ?? Date.now(),
    })
    this.tombstones.get(userId)?.delete(meta.contentHash)
  }

  async getActivity(
    userId: string,
    contentHash: string
  ): Promise<ActivityMeta | null> {
    return this.activities.get(userId)?.get(contentHash)?.meta ?? null
  }

  async getActivityBlob(
    userId: string,
    contentHash: string
  ): Promise<Uint8Array | null> {
    return this.activities.get(userId)?.get(contentHash)?.blob ?? null
  }

  async setActivityVisibility(
    userId: string,
    contentHash: string,
    isPublic: boolean
  ): Promise<ActivityMeta | null> {
    const stored = this.activities.get(userId)?.get(contentHash)
    if (!stored) return null
    stored.meta = { ...stored.meta, isPublic }
    return stored.meta
  }

  async deleteActivity(userId: string, contentHash: string): Promise<number> {
    this.activities.get(userId)?.delete(contentHash)
    let byHash = this.tombstones.get(userId)
    if (!byHash) {
      byHash = new Map<string, number>()
      this.tombstones.set(userId, byHash)
    }
    const deletedAt = Date.now()
    byHash.set(contentHash, deletedAt)
    return deletedAt
  }

  async purgeActivities(userId: string): Promise<number> {
    const activities = this.activities.get(userId)
    const count = activities?.size ?? 0
    // No tombstones — see the interface docs.
    activities?.clear()
    return count
  }

  async listAllActivitiesForUser(userId: string): Promise<Array<any>> {
    const userActivities = this.activities.get(userId)
    if (!userActivities) return []

    const activities: any[] = []
    for (const stored of userActivities.values()) {
      try {
        // Decompress the gzipped blob
        const decompressed = Bun.gunzipSync(
          stored.blob as Uint8Array<ArrayBuffer>
        )
        const json = new TextDecoder().decode(decompressed)
        const activityData = JSON.parse(json)
        activities.push({
          ...activityData,
          id: stored.meta.contentHash,
        })
      } catch (err) {
        console.error(
          `[export] Failed to parse activity ${stored.meta.contentHash}:`,
          err
        )
      }
    }

    return activities.sort(
      (a, b) => (a.startedAtMs ?? Infinity) - (b.startedAtMs ?? Infinity)
    )
  }

  async listSavedPointsManifest(
    userId: string,
    sinceCursor: number
  ): Promise<SavedPointManifestPage> {
    const since = Number.isFinite(sinceCursor) ? Math.max(0, sinceCursor) : 0
    const points = [...(this.savedPoints.get(userId)?.values() ?? [])]
      .map((point) => ({
        time: point.updatedAt,
        contentHash: point.id,
        point,
      }))
      .sort(comparePageable)
    const tombstones = [
      ...(this.savedPointTombstones.get(userId)?.entries() ?? []),
    ]
      .map(([id, deletedAt]) => ({
        time: deletedAt,
        contentHash: id,
        tombstone: { id, deletedAt } satisfies SavedPointTombstone,
      }))
      .sort(comparePageable)
    const slice =
      <T extends Pageable>(rows: T[]) =>
      (from: number, limit: number) =>
        rows.filter((row) => row.time >= from).slice(0, limit)
    const pointPage = await pageStream(slice(points), since, SYNC_PAGE_SIZE)
    const tombstonePage = await pageStream(
      slice(tombstones),
      since,
      SYNC_PAGE_SIZE
    )
    const { cursor, hasMore } = combineCursors(since, [
      pointPage,
      tombstonePage,
    ])
    return {
      savedPoints: pointPage.rows.map((row) => row.point),
      deletions: tombstonePage.rows.map((row) => row.tombstone),
      cursor,
      hasMore,
    }
  }

  async listSavedPoints(userId: string): Promise<SavedPoint[]> {
    return [...(this.savedPoints.get(userId)?.values() ?? [])].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
    )
  }

  async upsertSavedPoint(
    userId: string,
    point: SavedPoint
  ): Promise<SavedPoint> {
    let points = this.savedPoints.get(userId)
    if (!points) {
      points = new Map()
      this.savedPoints.set(userId, points)
    }
    const previous = points.get(point.id)
    const saved = {
      ...point,
      createdAt: previous?.createdAt ?? point.createdAt,
      updatedAt: Date.now(),
    }
    points.set(point.id, saved)
    this.savedPointTombstones.get(userId)?.delete(point.id)
    return saved
  }

  async deleteSavedPoint(userId: string, id: string): Promise<number> {
    this.savedPoints.get(userId)?.delete(id)
    let tombstones = this.savedPointTombstones.get(userId)
    if (!tombstones) {
      tombstones = new Map()
      this.savedPointTombstones.set(userId, tombstones)
    }
    const deletedAt = Date.now()
    tombstones.set(id, deletedAt)
    return deletedAt
  }

  async listAllSavedPointsForUser(userId: string): Promise<SavedPoint[]> {
    return this.listSavedPoints(userId)
  }

  async listPublicSavedPoints(userId: string): Promise<SavedPoint[]> {
    return (await this.listSavedPoints(userId)).filter(
      (point) => point.isPublic
    )
  }

  async findPublicSavedPoint(id: string): Promise<SavedPoint | null> {
    for (const points of this.savedPoints.values()) {
      const point = points.get(id)
      if (point?.isPublic) return point
    }
    return null
  }

  async findUserByHandle(handle: string): Promise<User | null> {
    const lower = handle.toLowerCase()
    for (const user of this.users.values()) {
      if (user.handle?.toLowerCase() === lower) return user
    }
    return null
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

    const userActivities = this.activities.get(userId)
    const activities: PublicActivityMeta[] = []

    if (userActivities) {
      for (const stored of userActivities.values()) {
        if (!stored.meta.isPublic) continue
        // Stats are denormalized onto `meta` at upload time (see putActivity),
        // so this never needs to decompress/parse the stored blob.
        activities.push({ ...stored.meta })
      }
    }

    activities.sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0))

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

  close(): void {
    this.users.clear()
    this.identities.clear()
    this.sessions.clear()
    this.activities.clear()
    this.tombstones.clear()
    this.savedPoints.clear()
    this.savedPointTombstones.clear()
    this.accessRequests.clear()
    this.settings.clear()
  }
}

export function createMemoryStore(): MemoryStore {
  return new MemoryStore()
}
