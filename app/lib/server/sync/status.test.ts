import { describe, expect, test } from "bun:test"
import {
  describeSyncStatus,
  getSyncStatus,
  setSyncStatus,
  summarizeSyncOutbox,
} from "./status"
import type { SyncOutboxItem } from "./repository"

function item(
  status: SyncOutboxItem["status"],
  id: string,
  availableAt = 0,
  attempts = 0
): SyncOutboxItem {
  return {
    id,
    dedupeKey: id,
    operation: "upload",
    payload: {},
    status,
    attempts,
    availableAt,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe("sync status", () => {
  test("summarizes durable outbox states and earliest retry", () => {
    expect(
      summarizeSyncOutbox([
        item("pending", "pending"),
        item("retryable", "retry-late", 500),
        item("retryable", "retry-soon", 200, 2),
        item("in-flight", "leased"),
        item("permanent", "permanent", 0, 3),
        item("complete", "complete", 0, 4),
      ])
    ).toEqual({
      pendingCount: 1,
      retryableCount: 2,
      inFlightCount: 1,
      permanentCount: 1,
      nextRetryAt: 200,
      retries: 9,
    })
  })

  test("describes cursor-held and permanent states without exposing payloads", () => {
    setSyncStatus({
      phase: "partial",
      message: "Some activities couldn't be received",
      cursorHeld: true,
      pendingCount: 1,
      retryableCount: 1,
      nextRetryAt: Date.now() + 60_000,
    })
    expect(describeSyncStatus(getSyncStatus())).toContain(
      "Some activities couldn't be received"
    )

    setSyncStatus({
      phase: "permanent",
      message: "An activity is too large to upload",
      permanentCount: 1,
    })
    expect(describeSyncStatus(getSyncStatus())).toBe(
      "An activity is too large to upload"
    )
  })
})
