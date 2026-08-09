/**
 * Thin fetch wrapper around the sync server.
 *
 * Holds the bearer token in a module variable rather than importing the auth
 * store, so the two modules do not form a cycle: `authStore` pushes the token
 * down here and registers what should happen when the server rejects it.
 */

import type { ApiError, ApiErrorCode } from "~shared/api"
import { apiUrl } from "./config"
import { reportServerReachable, reportServerUnreachable } from "./serverHealth"

let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

/** Registered by the auth store — fires once per rejected request. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

/** An error carrying the server's machine-readable code, when it sent one. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | "network"
  /** How long to wait before retrying. Only ever set on `rate_limited`. */
  readonly retryAfterMs: number | null

  constructor(
    status: number,
    code: ApiErrorCode | "network",
    message: string,
    retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

const FRIENDLY_MESSAGES: Partial<Record<ApiErrorCode | "network", string>> = {
  unauthorized: "Your session has expired. Please sign in again.",
  not_allowed: "This account isn't enabled for sync yet.",
  too_large: "That track is too large to upload.",
  rate_limited: "Too many requests — try again in a moment.",
  network: "Couldn't reach the server. Check your connection.",
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    return FRIENDLY_MESSAGES[err.code] ?? err.message
  }
  return err instanceof Error ? err.message : "Something went wrong."
}

interface RequestOptions {
  method?: string
  /** JSON-serialisable body. Mutually exclusive with `rawBody`. */
  body?: unknown
  /** Pre-encoded body (used for gzipped track uploads). */
  rawBody?: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Skip the Authorization header (used by the public auth endpoints). */
  anonymous?: boolean
}

async function request(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers }
  if (!opts.anonymous && authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? "GET",
      headers,
      body:
        opts.body !== undefined
          ? JSON.stringify(opts.body)
          : (opts.rawBody ?? null),
      signal: opts.signal,
      credentials: "omit",
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    reportServerUnreachable()
    throw new ApiRequestError(0, "network", "Network request failed")
  }

  // A response — even an error one — proves the server is up.
  reportServerReachable()

  if (res.ok) return res

  // Read the error body defensively — a proxy or a crash may return HTML.
  let code: ApiErrorCode = "server_error"
  let message = `Request failed with ${res.status}`
  let retryAfterMs: number | null = null
  try {
    const parsed = (await res.json()) as ApiError
    if (parsed?.error) code = parsed.error
    if (parsed?.message) message = parsed.message
    if (typeof parsed?.retryAfterMs === "number") {
      retryAfterMs = parsed.retryAfterMs
    }
  } catch {
    /* non-JSON error body — keep the defaults */
  }

  // Fall back to the standard header. Readable only because the server lists
  // it in `Access-Control-Expose-Headers`; a proxy-generated 429 may be the
  // only place the wait appears.
  if (retryAfterMs === null) {
    const seconds = Number(res.headers.get("Retry-After"))
    if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = seconds * 1000
  }

  if (res.status === 401) {
    code = "unauthorized"
    onUnauthorized?.()
  }

  throw new ApiRequestError(res.status, code, message, retryAfterMs)
}

export async function apiGet<T>(
  path: string,
  opts: Omit<RequestOptions, "method" | "body" | "rawBody"> = {}
): Promise<T> {
  const res = await request(path, { ...opts, method: "GET" })
  return (await res.json()) as T
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  opts: Omit<RequestOptions, "method" | "body"> = {}
): Promise<T> {
  const res = await request(path, { ...opts, method: "POST", body })
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** For endpoints that answer 204 — resolves on success, throws otherwise. */
export async function apiSend(
  method: string,
  path: string,
  opts: Omit<RequestOptions, "method"> = {}
): Promise<void> {
  await request(path, { ...opts, method })
}

/** Raw response, for the gzipped track blob endpoints. */
export function apiRaw(
  method: string,
  path: string,
  opts: Omit<RequestOptions, "method"> = {}
): Promise<Response> {
  return request(path, { ...opts, method })
}
