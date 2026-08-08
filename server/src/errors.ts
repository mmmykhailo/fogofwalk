/** Every non-2xx body on this server is an `ApiError`. */

import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import type { ApiError, ApiErrorCode } from "~shared/api"

const STATUS_BY_CODE: Record<ApiErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  not_allowed: 403,
  not_found: 404,
  bad_request: 400,
  too_large: 413,
  rate_limited: 429,
  server_error: 500,
}

/** Thrown anywhere; turned into an `ApiError` body by the app's error handler. */
export class HttpError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code)
    this.name = "HttpError"
    this.code = code
  }
}

export function errorBody(code: ApiErrorCode, message?: string): ApiError {
  return message ? { error: code, message } : { error: code }
}

export function statusFor(code: ApiErrorCode): ContentfulStatusCode {
  return STATUS_BY_CODE[code]
}

export function jsonError(
  c: Context,
  code: ApiErrorCode,
  message?: string
): Response {
  return c.json(errorBody(code, message), statusFor(code))
}
