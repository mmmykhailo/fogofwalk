export function isSyncCancellationError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

function createSyncCancellationError(): Error {
  const error = new Error("Sync cancelled")
  error.name = "AbortError"
  return error
}

export function throwIfSyncAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (isSyncCancellationError(reason)) throw reason
  throw createSyncCancellationError()
}
