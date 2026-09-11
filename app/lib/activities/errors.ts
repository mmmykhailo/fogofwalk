export type ActivityStorageErrorCode =
  | "unavailable"
  | "blocked"
  | "transaction-aborted"
  | "serialization"
  | "quota"
  | "schema"
  | "conflict"

export class ActivityStorageError extends Error {
  readonly code: Exclude<ActivityStorageErrorCode, "conflict">
  readonly retryable: boolean

  constructor(
    code: Exclude<ActivityStorageErrorCode, "conflict">,
    message: string,
    options?: { cause?: unknown; retryable?: boolean }
  ) {
    super(message, options)
    this.name = "ActivityStorageError"
    this.code = code
    this.retryable = options?.retryable ?? true
  }
}

export class ActivityLibraryConflictError extends Error {
  readonly code = "conflict" as const
  readonly expectedRevision: number
  readonly actualRevision: number

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Activity library changed from revision ${expectedRevision} to ${actualRevision}`
    )
    this.name = "ActivityLibraryConflictError"
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export function toActivityStorageError(
  error: unknown,
  operation: string
): ActivityStorageError {
  if (error instanceof ActivityStorageError) return error

  const name =
    error instanceof DOMException
      ? error.name
      : error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : ""

  if (name === "QuotaExceededError") {
    return new ActivityStorageError(
      "quota",
      `The activity could not be saved because browser storage is full (${operation}).`,
      { cause: error, retryable: false }
    )
  }
  if (name === "VersionError" || name === "InvalidStateError") {
    return new ActivityStorageError(
      "schema",
      `Browser storage could not open the activity database (${operation}).`,
      { cause: error }
    )
  }
  if (name === "AbortError") {
    return new ActivityStorageError(
      "transaction-aborted",
      `The activity save was aborted before it was committed (${operation}).`,
      { cause: error }
    )
  }
  if (name === "DataCloneError") {
    return new ActivityStorageError(
      "serialization",
      `The activity contains data the browser cannot store (${operation}).`,
      { cause: error, retryable: false }
    )
  }

  return new ActivityStorageError(
    "unavailable",
    `Browser storage was unavailable while ${operation}.`,
    { cause: error }
  )
}
