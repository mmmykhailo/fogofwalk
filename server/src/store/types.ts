/**
 * The storage seam. Everything above this interface is transport and policy;
 * everything below it is a driver (`sqlite-fs`, `memory`, and the extension
 * points documented in `server/README.md`).
 *
 * Every activity method takes `userId` first and filters on it. There is
 * deliberately no method that can read an activity without naming its owner —
 * cross-user isolation is a property of this interface, not of the callers.
 */

import type {
  AccessRequestStatus,
  AdminAccessRequest,
  AdminUser,
  ManifestPage,
  SavedPointManifestPage,
  NotificationStatus,
  PublicProfileResponse,
  ActivityMeta,
  UserStatus,
} from "~shared/api"
import type { SavedPoint } from "~shared/saved-points"

export interface User {
  id: string
  displayName: string
  /** Public URL handle, copied from the primary identity login. May be null. */
  handle: string | null
  avatarUrl: string | null
  status: UserStatus
  createdAt: number
  updatedAt: number
}

export interface Identity {
  provider: string
  providerUserId: string
  userId: string
  providerLogin: string | null
  email: string | null
  createdAt: number
}

export interface Session {
  tokenHash: string
  userId: string
  createdAt: number
  expiresAt: number
  lastUsedAt: number
}

/** What a provider's `exchange()` yields, ready to be persisted. */
export interface IdentityInput {
  provider: string
  providerUserId: string
  login: string
  displayName: string
  avatarUrl: string | null
  email: string | null
}

export interface StoredAccessRequest {
  id: string
  userId: string
  status: AccessRequestStatus
  requestedAt: number
  decidedAt: number | null
  decidedBy: string | null
  notificationStatus: NotificationStatus
  notificationAttemptedAt: number | null
}

/** The request plus whether this call inserted its one-per-user row. */
export interface AccessRequestCreation {
  request: StoredAccessRequest
  created: boolean
}

export interface ServerStore {
  // ── identities & users ──────────────────────────────────────────────────
  findUserByIdentity(
    provider: string,
    providerUserId: string
  ): Promise<User | null>
  upsertUserFromIdentity(input: IdentityInput): Promise<User>
  getUser(userId: string): Promise<User | null>
  setUserStatus(userId: string, status: UserStatus): Promise<User | null>
  setUserStatusWithAccessRequest(
    userId: string,
    status: UserStatus,
    adminUserId: string
  ): Promise<User | null>
  /**
   * Earliest identity for the user. `sessions` has no provider column, so this
   * is what `ServerUser.provider` reports.
   */
  findPrimaryIdentity(userId: string): Promise<Identity | null>
  /** All identities linked to the user (for data export). */
  findIdentitiesForUser(userId: string): Promise<Identity[]>
  /** Cascades identities, sessions, activities, tombstones and geometry blobs. */
  deleteUser(userId: string): Promise<void>
  getAccessRequest(userId: string): Promise<StoredAccessRequest | null>
  createAccessRequest(userId: string): Promise<AccessRequestCreation>
  setAccessRequestNotification(
    userId: string,
    status: NotificationStatus
  ): Promise<void>
  listAdminUsers(): Promise<AdminUser[]>
  listAdminRequests(): Promise<AdminAccessRequest[]>
  decideAccessRequest(
    requestId: string,
    decision: "approve" | "reject",
    adminUserId: string
  ): Promise<StoredAccessRequest | null>

  // ── administrator settings ─────────────────────────────────────────────
  getSetting(key: string): Promise<string | null>
  setSetting(
    key: string,
    value: string | null,
    updatedBy: string
  ): Promise<void>

  // ── sessions (token stored hashed, never in clear) ───────────────────────
  createSession(
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): Promise<void>
  findSession(tokenHash: string): Promise<Session | null>
  touchSession(tokenHash: string, lastUsedAt: number): Promise<void>
  deleteSession(tokenHash: string): Promise<void>
  deleteSessionsForUser(userId: string): Promise<void>
  /** All sessions for the user (for data export). */
  findSessionsForUser(userId: string): Promise<Session[]>

  // ── activities ──────────────────────────────────────────────────────────────
  listManifest(userId: string, sinceCursor: number): Promise<ManifestPage>
  putActivity(
    userId: string,
    meta: ActivityMeta,
    blob: Uint8Array
  ): Promise<void>
  getActivity(userId: string, contentHash: string): Promise<ActivityMeta | null>
  getActivityBlob(
    userId: string,
    contentHash: string
  ): Promise<Uint8Array | null>
  /**
   * Updates an activity's public visibility. Returns the new metadata, or null if
   * the activity does not belong to the user.
   */
  setActivityVisibility(
    userId: string,
    contentHash: string,
    isPublic: boolean
  ): Promise<ActivityMeta | null>
  /**
   * Removes the row and the blob and writes a tombstone. Idempotent.
   * Returns the tombstone's `deletedAt`, which the caller reports back so the
   * deleting device can record its own tombstone as already applied.
   */
  deleteActivity(userId: string, contentHash: string): Promise<number>
  /** All activities for the user with full geometry (for data export). */
  listAllActivitiesForUser(userId: string): Promise<Array<any>>
  /**
   * Removes every activity row and blob for the user and returns how many went.
   *
   * Deliberately writes **no tombstones**: this is the "wipe the server, keep
   * my devices" action. A tombstone would tell every other device to delete
   * its local copy, which is the opposite of what this is for. Other devices
   * keep their cached view that these activities are stored, so they also do not
   * re-upload them.
   */
  purgeActivities(userId: string): Promise<number>

  // ── saved points ────────────────────────────────────────────────────────
  listSavedPointsManifest(
    userId: string,
    sinceCursor: number
  ): Promise<SavedPointManifestPage>
  listSavedPoints(userId: string): Promise<SavedPoint[]>
  upsertSavedPoint(userId: string, point: SavedPoint): Promise<SavedPoint>
  deleteSavedPoint(userId: string, id: string): Promise<number>
  listAllSavedPointsForUser(userId: string): Promise<SavedPoint[]>
  listPublicSavedPoints(userId: string): Promise<SavedPoint[]>

  // ── public profiles ─────────────────────────────────────────────────────
  /**
   * Look up a user by their public handle. Does not expose the internal user id
   * or access status.
   */
  findUserByHandle(handle: string): Promise<User | null>
  /**
   * Public activities with their metadata for a user, newest first. The caller
   * already verified the user exists; this method returns only activities with
   * `is_public = 1` and never exposes geometry.
   */
  listPublicActivities(userId: string): Promise<PublicProfileResponse>

  /** Release file handles / connections. Tests call it; the server never does. */
  close?(): void
}
