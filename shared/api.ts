/**
 * Wire format for every request and response exchanged with the sync server.
 *
 * These declarations are the single source of truth: the server's route
 * handlers and the client's `apiClient` are both typed from this file, so a
 * field rename fails both typechecks instead of drifting silently.
 */

import type { ParsedTrack, TrackFormat } from "./tracks"

// ─── Auth ──────────────────────────────────────────────────────────────────────

/** One entry in the sign-in dialog. */
export interface AuthProviderInfo {
  id: string
  label: string
}

export interface AuthProvidersResponse {
  providers: AuthProviderInfo[]
}

/** Body of `POST /api/auth/exchange` — trades the OAuth handoff code for a token. */
export interface AuthExchangeRequest {
  code: string
}

export interface AuthExchangeResponse {
  token: string
  expiresAt: number
  user: ServerUser
  capabilities: UserCapabilities
}

// ─── User ──────────────────────────────────────────────────────────────────────

/**
 * Allowlist state. Everyone who completes OAuth becomes `pending`; only
 * `allowed` users may reach `/api/tracks/*`.
 */
export type UserStatus = "pending" | "allowed" | "blocked"

export interface ServerUser {
  id: string
  displayName: string
  avatarUrl: string | null
  /** Provider the current session was created with, e.g. "github". */
  provider: string
  status: UserStatus
}

export interface UserCapabilities {
  /** False until an admin allowlists the account. Gates all sync UI. */
  sync: boolean
}

export interface MeResponse {
  user: ServerUser
  capabilities: UserCapabilities
}

// ─── Tracks ────────────────────────────────────────────────────────────────────

/** A track's server-side metadata. Geometry is fetched separately by hash. */
export interface TrackMeta {
  contentHash: string
  name: string
  format: TrackFormat
  startedAtMs: number | null
  distanceKm: number
  pointCount: number
  sizeBytes: number
  updatedAt: number
}

export interface TrackTombstone {
  contentHash: string
  deletedAt: number
}

/**
 * Answer to `DELETE /api/tracks/:contentHash`.
 *
 * The timestamp matters: the deleting device has to record its own tombstone as
 * already applied, or its next sync re-applies it and deletes a track the user
 * has since deliberately re-imported.
 */
export interface TrackDeleteResponse {
  deletedAt: number
}

export interface ManifestPage {
  tracks: TrackMeta[]
  deletions: TrackTombstone[]
  /** Feed back as `?since=` on the next call. */
  cursor: number
  hasMore: boolean
}

/**
 * Upload body (gzipped JSON). `id` is stripped because ids are per-device —
 * the server keys on `contentHash`, and a downloading device mints its own.
 * `stats.uniqueDistanceKm` is zeroed on upload: it is relative to whichever
 * library computed it, so the receiving device recomputes rather than trusts.
 */
export type TrackUploadPayload = Omit<ParsedTrack, "id">

// ─── Errors ────────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "unauthorized"
  | "not_allowed"
  | "not_found"
  | "bad_request"
  | "too_large"
  | "rate_limited"
  | "server_error"

export interface ApiError {
  error: ApiErrorCode
  message?: string
  /**
   * How long to wait before retrying, on `rate_limited`.
   *
   * In the body rather than only in `Retry-After` because the client is
   * cross-origin: a response header is unreadable from JS unless CORS exposes
   * it, and this number has to survive any proxy in between.
   */
  retryAfterMs?: number
}
