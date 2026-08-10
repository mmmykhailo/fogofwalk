/**
 * Auth state as a module singleton, mirroring `mapStore.ts` — the codebase uses
 * no React Contexts. Components read it through `useAuth()`.
 *
 * Threading auth through `home.tsx → ControlPanel → MoreDrawer` would have
 * added props to an already 20-prop chain, none of which those two components
 * care about.
 */

import { useSyncExternalStore } from "react"
import type {
  AuthExchangeResponse,
  AuthProvidersResponse,
  MeResponse,
  ServerUser,
  UserCapabilities,
} from "~shared/api"
import {
  clearSession,
  clearSyncState,
  loadSession,
  saveSession,
} from "~/lib/storage"
import {
  apiGet,
  apiSend,
  setAuthToken,
  setUnauthorizedHandler,
} from "./apiClient"
import { isServerEnabled } from "./config"

export type AuthState =
  /** `VITE_API_URL` unset — this build has no server at all. */
  | { status: "disabled" }
  /** Restoring a stored session, or exchanging an OAuth handoff code. */
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: ServerUser; canSync: boolean }

let state: AuthState = isServerEnabled
  ? { status: "loading" }
  : { status: "disabled" }
let token: string | null = null

const listeners = new Set<() => void>()

function setState(next: AuthState) {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AuthState {
  return state
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Non-reactive read, for callers outside React (the sync engine). */
export function getAuthState(): AuthState {
  return state
}

export function getAuthToken(): string | null {
  return token
}

/** True when the user is signed in *and* allowlisted — the gate for all sync. */
export function canSync(): boolean {
  return state.status === "signedIn" && state.canSync
}

function applySession(
  nextToken: string,
  user: ServerUser,
  capabilities: UserCapabilities
) {
  token = nextToken
  setAuthToken(nextToken)
  setState({ status: "signedIn", user, canSync: capabilities.sync })
}

async function forgetSession() {
  token = null
  setAuthToken(null)
  setState({ status: "signedOut" })
  await Promise.all([clearSession(), clearSyncState()])
}

let isInitialised = false

/**
 * Restore a persisted session and revalidate it. Safe to call more than once —
 * `clientLoader` runs on every navigation back to the map.
 */
export async function initAuth(): Promise<void> {
  if (!isServerEnabled || isInitialised) return
  isInitialised = true

  // A 401 anywhere means the token is dead; drop it rather than retrying.
  setUnauthorizedHandler(() => {
    void forgetSession()
  })

  const stored = await loadSession()
  if (!stored || stored.expiresAt <= Date.now()) {
    if (stored) await clearSession()
    setState({ status: "signedOut" })
    return
  }

  // Render from the cached user immediately, then confirm against the server.
  applySession(stored.token, stored.user, stored.capabilities)

  try {
    const me = await apiGet<MeResponse>("/api/me")
    applySession(stored.token, me.user, me.capabilities)
    await saveSession({
      ...stored,
      user: me.user,
      capabilities: me.capabilities,
    })
  } catch {
    // Offline keeps the cached session; a 401 already cleared it via the handler.
  }
}

/** Called by the `/auth/callback` route once it has exchanged the handoff code. */
export async function completeSignIn(res: AuthExchangeResponse): Promise<void> {
  applySession(res.token, res.user, res.capabilities)
  await saveSession({
    token: res.token,
    expiresAt: res.expiresAt,
    user: res.user,
    capabilities: res.capabilities,
  })
}

export function setLoading(): void {
  setState({ status: "loading" })
}

export function setSignedOut(): void {
  setState({ status: "signedOut" })
}

export async function fetchProviders(): Promise<AuthProvidersResponse> {
  return apiGet<AuthProvidersResponse>("/api/auth/providers", {
    anonymous: true,
  })
}

export async function signOut(): Promise<void> {
  try {
    await apiSend("POST", "/api/auth/logout")
  } catch {
    // A failed revoke must not strand the user signed in on this device.
  }
  await forgetSession()
}

export async function deleteAccount(): Promise<void> {
  await apiSend("DELETE", "/api/account")
  await forgetSession()
}
