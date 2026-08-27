/**
 * Session tokens and OAuth handoff codes.
 *
 * A session token is 32 random bytes, handed to the client base64url-encoded
 * and stored **only** as its SHA-256 hex digest — a database dump therefore
 * contains nothing that can be replayed as a credential.
 */

import { HANDOFF_TTL_MS, SESSION_TTL_MS } from "~shared/constants"

import type { ServerStore, Session, User } from "../store/types"

// ─── tokens ────────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export interface MintedSession {
  token: string
  expiresAt: number
}

export async function createSessionFor(
  store: ServerStore,
  userId: string
): Promise<MintedSession> {
  const token = generateSessionToken()
  const expiresAt = Date.now() + SESSION_TTL_MS
  await store.createSession(userId, await hashToken(token), expiresAt)
  return { token, expiresAt }
}

export interface VerifiedSession {
  session: Session
  user: User
}

/**
 * Resolves a bearer token to its user, bumping `last_used_at`. An expired
 * session is deleted on sight rather than merely rejected, so the row does not
 * outlive its usefulness.
 */
export async function verifySessionToken(
  store: ServerStore,
  token: string
): Promise<VerifiedSession | null> {
  if (!token) return null

  const tokenHash = await hashToken(token)
  const session = await store.findSession(tokenHash)
  if (!session) return null

  const now = Date.now()
  if (session.expiresAt <= now) {
    await store.deleteSession(tokenHash)
    return null
  }

  const user = await store.getUser(session.userId)
  if (!user) {
    await store.deleteSession(tokenHash)
    return null
  }

  await store.touchSession(tokenHash, now)
  return { session: { ...session, lastUsedAt: now }, user }
}

export async function revokeSessionToken(
  store: ServerStore,
  token: string
): Promise<void> {
  await store.deleteSession(await hashToken(token))
}

// ─── handoff codes ─────────────────────────────────────────────────────────

/**
 * Single-use, 60-second codes that carry a freshly minted session token from
 * the OAuth callback redirect to `POST /api/auth/exchange`, so the long-lived
 * token never appears in a URL, in history, or in a `Referer` header.
 *
 * Deliberately in memory: they live for a minute and are worthless afterwards.
 * The trade-off is that a restart drops the sign-ins currently in flight —
 * those users see the callback fail and simply sign in again.
 */
interface HandoffEntry {
  userId: string
  token: string
  tokenExpiresAt: number
  expiresAt: number
}

const handoffCodes = new Map<string, HandoffEntry>()

function sweepHandoffCodes(now: number): void {
  for (const [code, entry] of handoffCodes) {
    if (entry.expiresAt <= now) handoffCodes.delete(code)
  }
}

export function createHandoffCode(
  userId: string,
  token: string,
  tokenExpiresAt: number
): string {
  const now = Date.now()
  sweepHandoffCodes(now)

  const code = generateSessionToken()
  handoffCodes.set(code, {
    userId,
    token,
    tokenExpiresAt,
    expiresAt: now + HANDOFF_TTL_MS,
  })
  return code
}

/** Consumes the code: a second call with the same value always returns null. */
export function consumeHandoffCode(code: string): HandoffEntry | null {
  const now = Date.now()
  sweepHandoffCodes(now)

  const entry = handoffCodes.get(code)
  if (!entry) return null
  handoffCodes.delete(code)
  if (entry.expiresAt <= now) return null
  return entry
}
