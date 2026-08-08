/**
 * The storage seam. Everything above this interface is transport and policy;
 * everything below it is a driver (`sqlite-fs`, `memory`, and the documented
 * extension points in plan §2).
 *
 * Every track method takes `userId` first and filters on it. There is
 * deliberately no method that can read a track without naming its owner —
 * cross-user isolation is a property of this interface, not of the callers.
 */

import type { ManifestPage, TrackMeta, UserStatus } from "~shared/api"

export interface User {
  id: string
  displayName: string
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

export interface ServerStore {
  // ── identities & users ──────────────────────────────────────────────────
  findUserByIdentity(
    provider: string,
    providerUserId: string
  ): Promise<User | null>
  upsertUserFromIdentity(input: IdentityInput): Promise<User>
  getUser(userId: string): Promise<User | null>
  setUserStatus(userId: string, status: UserStatus): Promise<User | null>
  /**
   * Earliest identity for the user. `sessions` has no provider column, so this
   * is what `ServerUser.provider` reports.
   */
  findPrimaryIdentity(userId: string): Promise<Identity | null>
  /** Cascades identities, sessions, tracks, tombstones and geometry blobs. */
  deleteUser(userId: string): Promise<void>

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

  // ── tracks ──────────────────────────────────────────────────────────────
  listManifest(userId: string, sinceCursor: number): Promise<ManifestPage>
  putTrack(userId: string, meta: TrackMeta, blob: Uint8Array): Promise<void>
  getTrack(userId: string, contentHash: string): Promise<TrackMeta | null>
  getTrackBlob(userId: string, contentHash: string): Promise<Uint8Array | null>
  /**
   * Removes the row and the blob and writes a tombstone. Idempotent.
   * Returns the tombstone's `deletedAt`, which the caller reports back so the
   * deleting device can record its own tombstone as already applied.
   */
  deleteTrack(userId: string, contentHash: string): Promise<number>
  /**
   * Removes every track row and blob for the user and returns how many went.
   *
   * Deliberately writes **no tombstones**: this is the "wipe the server, keep
   * my devices" action. A tombstone would tell every other device to delete
   * its local copy, which is the opposite of what this is for. Other devices
   * keep their cached view that these tracks are stored, so they also do not
   * re-upload them.
   */
  purgeTracks(userId: string): Promise<number>

  /** Release file handles / connections. Tests call it; the server never does. */
  close?(): void
}
