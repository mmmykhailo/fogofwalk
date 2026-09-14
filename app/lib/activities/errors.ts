export type ActivityStorageErrorCode =
  | "unavailable"
  | "blocked"
  | "transaction-aborted"
  | "serialization"
  | "quota"
  | "schema"
  | "conflict"

export type ActivityStorageError = Error & {
  readonly name: "ActivityStorageError"
  readonly code: Exclude<ActivityStorageErrorCode, "conflict">
  readonly retryable: boolean
}

export type ActivityLibraryConflictError = Error & {
  readonly name: "ActivityLibraryConflictError"
  readonly code: "conflict"
  readonly expectedRevision: number
  readonly actualRevision: number
}

export function createActivityStorageError(
  code: Exclude<ActivityStorageErrorCode, "conflict">,
  message: string,
  options?: { cause?: unknown; retryable?: boolean }
): ActivityStorageError {
  const error = new Error(message, options) as ActivityStorageError
  Object.assign(error, {
    name: "ActivityStorageError",
    code,
    retryable: options?.retryable ?? true,
  })
  return error
}

export function isActivityStorageError(
  error: unknown
): error is ActivityStorageError {
  return (
    error instanceof Error &&
    error.name === "ActivityStorageError" &&
    typeof (error as Partial<ActivityStorageError>).code === "string" &&
    typeof (error as Partial<ActivityStorageError>).retryable === "boolean"
  )
}

export function createActivityLibraryConflictError(
  expectedRevision: number,
  actualRevision: number
): ActivityLibraryConflictError {
  const error = new Error(
    `Activity library changed from revision ${expectedRevision} to ${actualRevision}`
  ) as ActivityLibraryConflictError
  Object.assign(error, {
    name: "ActivityLibraryConflictError",
    code: "conflict",
    expectedRevision,
    actualRevision,
  })
  return error
}

export function isActivityLibraryConflictError(
  error: unknown
): error is ActivityLibraryConflictError {
  return (
    error instanceof Error &&
    error.name === "ActivityLibraryConflictError" &&
    error instanceof Error &&
    (error as Partial<ActivityLibraryConflictError>).code === "conflict" &&
    Number.isSafeInteger(
      (error as Partial<ActivityLibraryConflictError>).expectedRevision
    ) &&
    Number.isSafeInteger(
      (error as Partial<ActivityLibraryConflictError>).actualRevision
    )
  )
}

export function toActivityStorageError(
  error: unknown,
  operation: string
): ActivityStorageError {
  if (isActivityStorageError(error)) return error

  const name =
    error instanceof DOMException
      ? error.name
      : error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : ""

  if (name === "QuotaExceededError") {
    return createActivityStorageError(
      "quota",
      `The activity could not be saved because browser storage is full (${operation}).`,
      { cause: error, retryable: false }
    )
  }
  if (name === "VersionError" || name === "InvalidStateError") {
    return createActivityStorageError(
      "schema",
      `Browser storage could not open the activity database (${operation}).`,
      { cause: error }
    )
  }
  if (name === "AbortError") {
    return createActivityStorageError(
      "transaction-aborted",
      `The activity save was aborted before it was committed (${operation}).`,
      { cause: error }
    )
  }
  if (name === "DataCloneError") {
    return createActivityStorageError(
      "serialization",
      `The activity contains data the browser cannot store (${operation}).`,
      { cause: error, retryable: false }
    )
  }

  return createActivityStorageError(
    "unavailable",
    `Browser storage was unavailable while ${operation}.`,
    { cause: error }
  )
}
