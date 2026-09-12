import type {
  ActivityType,
  ParsedActivity,
  StartSunPhase,
} from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"

export type LibraryRevision = number
export type OperationId = string

export interface ActivityMetadataPatch {
  id: string
  name?: string
  isPublic?: boolean
  activityType?: ActivityType | null
  startSunPhase?: StartSunPhase | null
}

export interface LibraryChangeDomains {
  membership: boolean
  geometry: boolean
  metadata: boolean
  statistics: boolean
}

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
  | {
      type: "updateMetadata"
      operationId: OperationId
      patches: ActivityMetadataPatch[]
    }

export interface LibraryChange {
  operationId: OperationId
  fromRevision: LibraryRevision
  revision: LibraryRevision
  added: ParsedActivity[]
  updated: ParsedActivity[]
  removed: ParsedActivity[]
  duplicates: DuplicateReason[]
  domains: LibraryChangeDomains
}

export interface LibrarySnapshot {
  revision: LibraryRevision
  coverageRevision: LibraryRevision
  activities: readonly ParsedActivity[]
}

export interface LibraryCommit {
  snapshot: LibrarySnapshot
  change: LibraryChange
}

export interface LibraryMetadataCommit {
  operationId: OperationId
  fromRevision: LibraryRevision
  revision: LibraryRevision
  coverageRevision: LibraryRevision
  updated: ActivitySummary[]
}

export interface LibrarySummarySnapshot {
  revision: LibraryRevision
  coverageRevision: LibraryRevision
  summaries: readonly ActivitySummary[]
}

export type LibraryMetadataListener = (
  snapshot: LibrarySummarySnapshot,
  commit: LibraryMetadataCommit
) => void

export type LibraryListener = (
  snapshot: LibrarySnapshot,
  change: LibraryChange
) => void
