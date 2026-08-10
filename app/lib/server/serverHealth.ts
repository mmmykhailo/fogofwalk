/**
 * Reachability of the sync server.
 *
 * Every account and sync surface needs to say something honest when the server
 * is down, rather than spinning forever or showing an empty list that looks
 * like "you have nothing". `apiClient` reports into this on every request, so
 * the state is a by-product of traffic the app was making anyway — the explicit
 * `pingServer()` is only for when there is no traffic to learn from.
 */

import { useEffect, useSyncExternalStore } from "react"
import { apiUrl, isServerEnabled } from "./config"

export type ServerHealth = "unknown" | "online" | "offline"

let health: ServerHealth = "unknown"
const listeners = new Set<() => void>()

function setHealth(next: ServerHealth) {
  if (health === next) return
  health = next
  for (const listener of listeners) listener()
}

/** A response arrived — even a 500 proves the server is reachable. */
export function reportServerReachable(): void {
  setHealth("online")
}

/** `fetch` itself rejected: DNS, TLS, CORS, offline device, server down. */
export function reportServerUnreachable(): void {
  setHealth("offline")
}

export function getServerHealth(): ServerHealth {
  return health
}

const PING_TIMEOUT_MS = 5000

/** Probe `/health`. Resolves true when the server answered. */
export async function pingServer(): Promise<boolean> {
  if (!isServerEnabled) return false
  try {
    await fetch(apiUrl("/health"), {
      method: "GET",
      credentials: "omit",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    reportServerReachable()
    return true
  } catch {
    reportServerUnreachable()
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Current reachability. Pass `probeWhenUnknown` on surfaces that render before
 * any request has been made (the drawer opens without necessarily calling the
 * API), so they can show an offline placeholder instead of a hopeful default.
 */
export function useServerHealth(probeWhenUnknown = false): ServerHealth {
  const value = useSyncExternalStore(
    subscribe,
    () => health,
    () => health
  )

  useEffect(() => {
    if (probeWhenUnknown && isServerEnabled && value === "unknown") {
      void pingServer()
    }
  }, [probeWhenUnknown, value])

  return value
}
