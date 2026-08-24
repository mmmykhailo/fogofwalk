/**
 * Wire format for every request and response exchanged with the sync server.
 *
 * These declarations are the single source of truth: the server's route
 * handlers and the client's `apiClient` are both typed from this file, so a
 * field rename fails both typechecks instead of drifting silently.
 */

import type { ActivityFormat, ActivityType, ParsedActivity } from "./activities"

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
 * `allowed` users may reach `/api/activities/*`.
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
    activityCount: number
    publicActivityCount: number
    activitySizeBytes: number
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

// ─── Activities ────────────────────────────────────────────────────────────────────

/** An activity's server-side metadata. Geometry is fetched separately by hash. */
export interface ActivityMeta {
  contentHash: string
  name: string
  isPublic: boolean
  format: ActivityFormat
  activityType?: ActivityType
  startedAtMs: number | null
  distanceKm: number
  pointCount: number
  sizeBytes: number
  updatedAt: number
  // Denormalized from `stats` at upload time so the public profile endpoint
  // can list activities without decompressing and parsing every blob.
  durationMs: number | null
  movingTimeMs: number | null
  elevationGainM: number
  avgMovingSpeedKmh: number | null
}

/** Activity metadata displayed on a public profile; geometry stays private. */
export type PublicActivityMeta = ActivityMeta

export interface PublicProfileResponse {
  user: PublicProfileUser
  activities: PublicActivityMeta[]
}

export interface ActivityTombstone {
  contentHash: string
  deletedAt: number
}

/**
 * Answer to `DELETE /api/activities/:contentHash`.
 *
 * The timestamp matters: the deleting device has to record its own tombstone as
 * already applied, or its next sync re-applies it and deletes an activity the user
 * has since deliberately re-imported.
 */
export interface ActivityDeleteResponse {
  deletedAt: number
}

export interface ActivityVisibilityUpdateRequest {
  isPublic: boolean
}

export interface ActivityVisibilityUpdateResponse {
  contentHash: string
  isPublic: boolean
  updatedAt: number
}

export interface ManifestPage {
  activities: ActivityMeta[]
  deletions: ActivityTombstone[]
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
export type ActivityUploadPayload = Omit<ParsedActivity, "id">

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
  activities: ParsedActivity[]
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
