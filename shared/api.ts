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
  /** Public URL handle, when the provider account has one. */
  handle: string | null
  /** Provider the current session was created with, e.g. "github". */
  provider: string
  status: UserStatus
}

export interface UserCapabilities {
  /** False until an admin approves the account. Gates all sync UI. */
  sync: boolean
  /** Presentation hint only; admin API authorization is always server-side. */
  admin: boolean
}

export interface MeResponse {
  user: ServerUser
  capabilities: UserCapabilities
}

export type AccessRequestStatus = "pending" | "approved" | "rejected"
export type NotificationStatus = "not_configured" | "sent" | "failed"

export interface AccessRequest {
  status: AccessRequestStatus
  requestedAt: number
}

export interface AdminAccessRequest extends AccessRequest {
  id: string
  userId: string
  displayName: string
  identity: string | null
  notificationStatus: NotificationStatus
  notificationAttemptedAt: number | null
  decidedAt: number | null
}

export interface AdminUser {
  id: string
  displayName: string
  avatarUrl: string | null
  handle: string | null
  status: UserStatus
  updatedAt: number
  identity: string | null
  request: AdminAccessRequest | null
  storage: {
    trackCount: number
    publicTrackCount: number
    trackSizeBytes: number
  }
}

export interface AdminBootstrapResponse {
  requests: AdminAccessRequest[]
  users: AdminUser[]
  telegramChatId: string | null
  isBotTokenConfigured: boolean
}

export interface TelegramSettingsRequest {
  chatId?: string
  token?: string
  clearChatId?: boolean
  clearToken?: boolean
}

// ─── Public profiles ───────────────────────────────────────────────────────────

export interface PublicProfileUser {
  handle: string
  displayName: string
  avatarUrl: string | null
}

// ─── Tracks ────────────────────────────────────────────────────────────────────

/** A track's server-side metadata. Geometry is fetched separately by hash. */
export interface TrackMeta {
  contentHash: string
  name: string
  isPublic: boolean
  format: TrackFormat
  startedAtMs: number | null
  distanceKm: number
  pointCount: number
  sizeBytes: number
  updatedAt: number
  // Denormalized from `stats` at upload time so the public profile endpoint
  // can list tracks without decompressing and parsing every blob.
  durationMs: number | null
  movingTimeMs: number | null
  elevationGainM: number
  avgMovingSpeedKmh: number | null
}

/** Track metadata displayed on a public profile; geometry stays private. */
export type PublicTrackMeta = TrackMeta

export interface PublicProfileResponse {
  user: PublicProfileUser
  tracks: PublicTrackMeta[]
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

export interface TrackVisibilityUpdateRequest {
  isPublic: boolean
}

export interface TrackVisibilityUpdateResponse {
  contentHash: string
  isPublic: boolean
  updatedAt: number
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

// ─── Data Export (GDPR Right of Access) ────────────────────────────────────────

export interface ExportedIdentity {
  provider: string
  providerUserId: string
  login: string | null
  email: string | null
  createdAt: number
}

export interface ExportedSession {
  createdAt: number
  expiresAt: number
  lastUsedAt: number
}

export interface DataExportResponse {
  exportedAt: string
  account: ServerUser & { createdAt: number }
  identities: ExportedIdentity[]
  sessions: ExportedSession[]
  tracks: ParsedTrack[]
}

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
