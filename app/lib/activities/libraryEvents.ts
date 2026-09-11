import type { ParsedActivity } from "~/types/activities"

export type LibraryRevision = number
export type OperationId = string

export type DuplicateReasonCode =
  | "content-hash"
  | "activity-id"
  | "remote-content-hash"

export interface DuplicateReason {
  activityId: string
  contentHash?: string
  existingActivityId?: string
  reason: DuplicateReasonCode
}

export type RemoteChange =
  | { type: "upsert"; activity: ParsedActivity }
  | {
      type: "delete"
      contentHash: string
      deletedAt?: number
    }

export type LibraryCommand =
  | {
      type: "import"
      operationId: OperationId
      activities: ParsedActivity[]
    }
  | {
      type: "applyRemote"
      operationId: OperationId
      changes: RemoteChange[]
    }
  | {
      type: "delete"
      operationId: OperationId
      activityId: string
    }
  | {
      type: "clearLocal"
      operationId: OperationId
    }

export interface LibraryChange {
  operationId: OperationId
  fromRevision: LibraryRevision
  revision: LibraryRevision
  added: ParsedActivity[]
  updated: ParsedActivity[]
  removed: ParsedActivity[]
  duplicates: DuplicateReason[]
}

export interface LibrarySnapshot {
  revision: LibraryRevision
  activities: readonly ParsedActivity[]
}

export interface LibraryCommit {
  snapshot: LibrarySnapshot
  change: LibraryChange
}

export type LibraryListener = (
  snapshot: LibrarySnapshot,
  change: LibraryChange
) => void
