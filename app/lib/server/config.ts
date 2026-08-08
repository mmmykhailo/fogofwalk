/**
 * Sync-server configuration.
 *
 * The app is server-optional by design: `VITE_API_URL` is unset in the GitHub
 * Pages build, which makes `isServerEnabled` false and compiles every account
 * and sync surface out of the UI. Nothing below this module may be imported in
 * a way that runs a network request when the flag is false.
 */

const raw = import.meta.env.VITE_API_URL as string | undefined

/** Base URL of the sync server, without a trailing slash. Null when disabled. */
export const API_URL: string | null =
  typeof raw === "string" && raw.trim().length > 0
    ? raw.trim().replace(/\/+$/, "")
    : null

export const isServerEnabled = API_URL !== null

/** Absolute URL for an API path. Throws when the server is disabled — callers must guard. */
export function apiUrl(path: string): string {
  if (!API_URL) {
    throw new Error("Sync server is disabled (VITE_API_URL is not set)")
  }
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * Where the server should send the browser back after OAuth, as an origin plus
 * the app's base path — GitHub Pages serves this app from `/<repo>/`, so
 * `location.origin` alone would drop the prefix and 404 the callback route.
 * The server validates this against its own `ALLOWED_ORIGINS`.
 */
export function clientRedirectBase(): string {
  const base = import.meta.env.BASE_URL || "/"
  return `${window.location.origin}${base}`.replace(/\/+$/, "")
}

/** URL that starts the OAuth dance for a provider. */
export function signInUrl(providerId: string): string {
  const redirect = encodeURIComponent(clientRedirectBase())
  return apiUrl(
    `/api/auth/${encodeURIComponent(providerId)}/start?redirect=${redirect}`
  )
}
