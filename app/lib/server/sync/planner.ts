/**
 * Pure activity-sync reconciliation.
 *
 * The executor is deliberately not part of this module.  A plan describes
 * what a caller may do with one manifest window and which effects must finish
 * before the window's cursor can be durably committed.  In particular, an
 * upload that is local-only does not hold the receive cursor, while a failed
 * download, metadata application, or tombstone application does.
 */

import type { ActivityMeta, ActivityTombstone } from "~shared/api"
import type { ActivityType, StartSunPhase } from "~shared/activities"

/** The metadata needed to decide reconciliation; geometry stays out of plans. */
export interface LocalActivityMetadata {
  readonly id: string
  readonly name: string
  readonly contentHash?: string
  readonly isPublic?: boolean
  readonly activityType?: ActivityType
  readonly startSunPhase?: StartSunPhase
}

/**
 * The activity portion of durable sync state.
 *
 * It intentionally mirrors the activity fields in `storage.SyncState` without
 * importing storage at runtime.  A planner call therefore cannot open IDB or
 * acquire any other application resource.
 */
export interface SyncPlannerState {
  readonly cursor: number
  readonly serverHashes: readonly string[]
  readonly ignoredHashes?: readonly string[]
  readonly appliedTombstones?: Readonly<Record<string, number>>
}

/** A manifest response together with the cursor it was requested from. */
export interface RemoteActivityWindow {
  readonly since?: number
  readonly activities: readonly ActivityMeta[]
  readonly deletions: readonly ActivityTombstone[]
  readonly cursor: number
  readonly hasMore: boolean
}

export type UploadIntentReason =
  | "local-only"
  | "local-wins-from-scratch"
  | "backfill-sun-phase"
  | "resurrect"

export type MetadataField =
  | "name"
  | "isPublic"
  | "activityType"
  | "startSunPhase"

export type MetadataConflictResolution =
  | "local-wins-from-scratch"
  | "remote-wins-incremental"
  | "local-derived-sun-phase-wins"

export interface MetadataConflict {
  readonly kind: "metadata"
  readonly contentHash: string
  readonly fields: readonly MetadataField[]
  readonly resolution: MetadataConflictResolution
}

export interface RemoteEventConflict {
  readonly kind: "remote-event"
  readonly contentHash: string
  readonly activityUpdatedAt: number
  readonly tombstoneDeletedAt: number
  /** The newest event wins; equal timestamps deliberately favor deletion. */
  readonly resolution: "activity-wins" | "tombstone-wins"
}

export interface DuplicateLocalConflict {
  readonly kind: "duplicate-local-hash"
  readonly contentHash: string
  readonly localIds: readonly string[]
  /** Canonical local data should make this impossible; lowest id is stable. */
  readonly resolution: "lowest-id-wins"
}

export type SyncConflict =
  | MetadataConflict
  | RemoteEventConflict
  | DuplicateLocalConflict

interface IntentBase {
  /** Stable across repeated planning of the same immutable input. */
  readonly intentId: string
}

export interface UploadActivityIntent extends IntentBase {
  readonly type: "upload"
  readonly contentHash: string
  readonly activity: LocalActivityMetadata
  readonly reason: UploadIntentReason
  /** Metadata convergence for a received row must precede cursor commit. */
  readonly requiresCursor: boolean
}

export interface DownloadActivityIntent extends IntentBase {
  readonly type: "download"
  readonly contentHash: string
  readonly remote: ActivityMeta
  readonly reason: "remote-only"
}

export interface ApplyRemoteMetadataIntent extends IntentBase {
  readonly type: "apply-remote-metadata"
  readonly contentHash: string
  readonly localId: string
  readonly remote: ActivityMeta
  readonly reason: "remote-wins-incremental"
}

export interface ApplyRemoteTombstoneIntent extends IntentBase {
  readonly type: "apply-remote-tombstone"
  readonly contentHash: string
  readonly localId?: string
  readonly deletedAt: number
  readonly reason: "fresh-tombstone"
}

export interface KeepLocalOnlyIntent extends IntentBase {
  readonly type: "keep-local-only"
  readonly contentHash: string
  readonly localId?: string
  readonly reason: "ignored-hash"
}

export type NoOpIntentReason =
  | "already-present"
  | "known-remote"
  | "empty-window"
  | "historical-tombstone"
  | "replayed-tombstone"
  | "missing-content-hash"

export interface NoOpIntent extends IntentBase {
  readonly type: "no-op"
  readonly contentHash?: string
  readonly localId?: string
  readonly reason: NoOpIntentReason
}

export type SyncIntent =
  | UploadActivityIntent
  | DownloadActivityIntent
  | ApplyRemoteMetadataIntent
  | ApplyRemoteTombstoneIntent
  | KeepLocalOnlyIntent
  | NoOpIntent

export type SyncPlanDiagnosticCode =
  | "invalid-state-cursor"
  | "invalid-window-cursor"
  | "stale-window"
  | "decreasing-cursor"
  | "non-advancing-page"

export interface SyncPlanDiagnostic {
  readonly code: SyncPlanDiagnosticCode
  readonly message: string
}

export type CursorHoldReason =
  | "replayed-final-window"
  | "stale-window"
  | "decreasing-cursor"
  | "non-advancing-page"
  | "protocol-error"

export type CursorAdvanceReason = "window-applied" | "page-applied"

export type CursorIntent =
  | {
      readonly type: "advance"
      readonly from: number
      readonly to: number
      /** These effects are a prerequisite, not merely related work. */
      readonly requiresIntentIds: readonly string[]
      readonly reason: CursorAdvanceReason
    }
  | {
      readonly type: "hold"
      readonly at: number
      readonly reason: CursorHoldReason
      readonly diagnosticCode?: SyncPlanDiagnosticCode
    }

export interface PlannedSyncState extends SyncPlannerState {
  readonly ignoredHashes: readonly string[]
  readonly appliedTombstones: Readonly<Record<string, number>>
}

export interface SyncPlannerInput {
  readonly localActivities: readonly LocalActivityMetadata[]
  readonly state: SyncPlannerState
  readonly remote: RemoteActivityWindow
}

export interface SyncPlan {
  /** Ordered by effect dependency, then by content hash. */
  readonly intents: readonly SyncIntent[]
  /** Resolved conflicts remain visible even when policy yields an intent. */
  readonly conflicts: readonly SyncConflict[]
  readonly cursor: CursorIntent
  /** Candidate state; persist it only after `cursor` prerequisites succeed. */
  readonly nextState: PlannedSyncState
  readonly diagnostics: readonly SyncPlanDiagnostic[]
}

const INTENT_ORDER: Record<SyncIntent["type"], number> = {
  "apply-remote-tombstone": 0,
  upload: 1,
  download: 2,
  "apply-remote-metadata": 3,
  "keep-local-only": 4,
  "no-op": 5,
}

function sortedUnique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort(compareStableText)
}

function copyState(state: SyncPlannerState): PlannedSyncState {
  const tombstones = Object.entries(state.appliedTombstones ?? {})
    .sort(([a], [b]) => compareStableText(a, b))
    .reduce<Record<string, number>>((result, [hash, deletedAt]) => {
      result[hash] = deletedAt
      return result
    }, {})

  return {
    cursor: state.cursor,
    serverHashes: sortedUnique(state.serverHashes),
    ignoredHashes: sortedUnique(state.ignoredHashes),
    appliedTombstones: tombstones,
  }
}

function emptyPlan(
  state: SyncPlannerState,
  diagnostic: SyncPlanDiagnostic,
  reason: CursorHoldReason = "protocol-error"
): SyncPlan {
  const nextState = copyState(state)
  return {
    intents: [],
    conflicts: [],
    cursor: {
      type: "hold",
      at: state.cursor,
      reason,
      diagnosticCode: diagnostic.code,
    },
    nextState,
    diagnostics: [diagnostic],
  }
}

function compareStableText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function activityTieKey(activity: ActivityMeta): string {
  return JSON.stringify([
    activity.name,
    activity.isPublic,
    activity.format,
    activity.activityType ?? null,
    activity.startSunPhase ?? null,
    activity.startedAtMs,
    activity.distanceKm,
    activity.pointCount,
    activity.sizeBytes,
    activity.durationMs,
    activity.movingTimeMs,
    activity.elevationGainM,
    activity.avgMovingSpeedKmh,
  ])
}

function chooseRemoteActivity(
  current: ActivityMeta | undefined,
  candidate: ActivityMeta
): ActivityMeta {
  if (!current) return candidate
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt ? candidate : current
  }
  return compareStableText(activityTieKey(candidate), activityTieKey(current)) >
    0
    ? candidate
    : current
}

function chooseRemoteTombstone(
  current: ActivityTombstone | undefined,
  candidate: ActivityTombstone
): ActivityTombstone {
  if (!current || candidate.deletedAt > current.deletedAt) return candidate
  return current
}

interface RemoteRecord {
  readonly contentHash: string
  readonly activity?: ActivityMeta
  readonly tombstone?: ActivityTombstone
  readonly winner: "activity" | "tombstone"
}

function buildRemoteRecords(
  remote: RemoteActivityWindow
): Map<string, RemoteRecord> {
  const activities = new Map<string, ActivityMeta>()
  for (const activity of remote.activities) {
    activities.set(
      activity.contentHash,
      chooseRemoteActivity(activities.get(activity.contentHash), activity)
    )
  }

  const tombstones = new Map<string, ActivityTombstone>()
  for (const tombstone of remote.deletions) {
    tombstones.set(
      tombstone.contentHash,
      chooseRemoteTombstone(tombstones.get(tombstone.contentHash), tombstone)
    )
  }

  const hashes = sortedUnique([...activities.keys(), ...tombstones.keys()])
  const records = new Map<string, RemoteRecord>()
  for (const contentHash of hashes) {
    const activity = activities.get(contentHash)
    const tombstone = tombstones.get(contentHash)
    const winner =
      tombstone && (!activity || activity.updatedAt <= tombstone.deletedAt)
        ? "tombstone"
        : "activity"
    records.set(contentHash, {
      contentHash,
      activity,
      tombstone,
      winner,
    })
  }
  return records
}

function differingMetadataFields(
  local: LocalActivityMetadata,
  remote: ActivityMeta
): MetadataField[] {
  const fields: MetadataField[] = []
  if (local.name !== remote.name) fields.push("name")
  if (Boolean(local.isPublic) !== remote.isPublic) fields.push("isPublic")
  if (local.activityType !== remote.activityType) fields.push("activityType")
  if (local.startSunPhase !== remote.startSunPhase) {
    fields.push("startSunPhase")
  }
  return fields
}

function copyLocal(activity: LocalActivityMetadata): LocalActivityMetadata {
  return { ...activity }
}

function copyRemote(activity: ActivityMeta): ActivityMeta {
  return { ...activity }
}

function compareIntent(a: SyncIntent, b: SyncIntent): number {
  const order = INTENT_ORDER[a.type] - INTENT_ORDER[b.type]
  if (order !== 0) return order

  const aHash = a.contentHash ?? ""
  const bHash = b.contentHash ?? ""
  const hash = compareStableText(aHash, bHash)
  if (hash !== 0) return hash

  const aId = "localId" in a ? (a.localId ?? "") : ""
  const bId = "localId" in b ? (b.localId ?? "") : ""
  const localId = compareStableText(aId, bId)
  if (localId !== 0) return localId
  return compareStableText(a.intentId, b.intentId)
}

function compareConflict(a: SyncConflict, b: SyncConflict): number {
  const kind = compareStableText(a.kind, b.kind)
  if (kind !== 0) return kind
  return compareStableText(a.contentHash, b.contentHash)
}

function makeIntentId(type: SyncIntent["type"], key: string): string {
  return `${type}:${key}`
}

function requiredIntentIds(intents: readonly SyncIntent[]): string[] {
  return intents
    .filter((intent) => {
      if (
        intent.type === "download" ||
        intent.type === "apply-remote-metadata" ||
        intent.type === "apply-remote-tombstone"
      ) {
        return true
      }
      return intent.type === "upload" && intent.requiresCursor
    })
    .map((intent) => intent.intentId)
    .sort(compareStableText)
}

/**
 * Return whether all effects guarded by an advance intent have completed.
 * Keeping this helper pure makes the cursor safety rule hard for an executor
 * to accidentally weaken.
 */
export function isCursorIntentReady(
  cursor: CursorIntent,
  completedIntentIds: readonly string[]
): boolean {
  if (cursor.type === "hold") return false
  const completed = new Set(completedIntentIds)
  return cursor.requiresIntentIds.every((intentId) => completed.has(intentId))
}

/**
 * Plan one deterministic reconciliation pass over one validated manifest
 * window.  The returned `nextState` is only a candidate: an executor must
 * satisfy `cursor.requiresIntentIds` before persisting its cursor.
 */
export function planActivitySync(input: SyncPlannerInput): SyncPlan {
  const { localActivities, state, remote } = input
  const since = remote.since ?? state.cursor

  if (!Number.isFinite(state.cursor) || state.cursor < 0) {
    return emptyPlan(state, {
      code: "invalid-state-cursor",
      message: "The durable sync cursor must be a finite non-negative number.",
    })
  }

  if (!Number.isFinite(since) || since < 0 || !Number.isFinite(remote.cursor)) {
    return emptyPlan(state, {
      code: "invalid-window-cursor",
      message: "The manifest window has an invalid cursor.",
    })
  }

  if (since !== state.cursor) {
    return emptyPlan(
      state,
      {
        code: "stale-window",
        message: `The manifest was planned from cursor ${since}, but durable state is at ${state.cursor}.`,
      },
      "stale-window"
    )
  }

  if (remote.cursor < since) {
    return emptyPlan(
      state,
      {
        code: "decreasing-cursor",
        message: `The manifest cursor moved backwards from ${since} to ${remote.cursor}.`,
      },
      "decreasing-cursor"
    )
  }

  if (remote.hasMore && remote.cursor === since) {
    return emptyPlan(
      state,
      {
        code: "non-advancing-page",
        message:
          "A manifest page marked as having more data did not advance its cursor.",
      },
      "non-advancing-page"
    )
  }

  const fromScratch = since === 0
  const baseKnownServerHashes = new Set(
    fromScratch ? [] : sortedUnique(state.serverHashes)
  )
  const candidateServerHashes = new Set(baseKnownServerHashes)
  const ignoredHashes = new Set(sortedUnique(state.ignoredHashes))
  const appliedTombstoneMemory = new Map<string, number>(
    Object.entries(state.appliedTombstones ?? {})
  )
  const candidateAppliedTombstones = new Map(appliedTombstoneMemory)
  for (const tombstone of remote.deletions) {
    const seen = candidateAppliedTombstones.get(tombstone.contentHash)
    if (seen === undefined || tombstone.deletedAt > seen) {
      candidateAppliedTombstones.set(tombstone.contentHash, tombstone.deletedAt)
    }
  }

  const localByHash = new Map<string, LocalActivityMetadata>()
  const localWithoutHash: LocalActivityMetadata[] = []
  const conflicts: SyncConflict[] = []
  for (const activity of localActivities) {
    if (!activity.contentHash) {
      localWithoutHash.push(activity)
      continue
    }

    const current = localByHash.get(activity.contentHash)
    if (!current) {
      localByHash.set(activity.contentHash, activity)
      continue
    }

    const localIds = [current.id, activity.id].sort(compareStableText)
    const winner = localIds[0] === current.id ? current : activity
    localByHash.set(activity.contentHash, winner)
    conflicts.push({
      kind: "duplicate-local-hash",
      contentHash: activity.contentHash,
      localIds,
      resolution: "lowest-id-wins",
    })
  }

  const remoteRecords = buildRemoteRecords(remote)

  // A missing content hash cannot safely be uploaded. It remains a visible,
  // explicit no-op until the hash backfill stage provides one.
  const intents: SyncIntent[] = localWithoutHash
    .slice()
    .sort((a, b) => compareStableText(a.id, b.id))
    .map((activity) => ({
      type: "no-op",
      intentId: makeIntentId("no-op", `missing-content-hash:${activity.id}`),
      localId: activity.id,
      reason: "missing-content-hash",
    }))

  const allHashes = sortedUnique([
    ...localByHash.keys(),
    ...remoteRecords.keys(),
  ])

  for (const contentHash of allHashes) {
    const local = localByHash.get(contentHash)
    const record = remoteRecords.get(contentHash)
    const remoteActivity =
      record?.winner === "activity" ? record.activity : undefined
    const remoteTombstone =
      record?.winner === "tombstone" ? record.tombstone : undefined

    if (record?.activity && record.tombstone) {
      conflicts.push({
        kind: "remote-event",
        contentHash,
        activityUpdatedAt: record.activity.updatedAt,
        tombstoneDeletedAt: record.tombstone.deletedAt,
        resolution:
          record.winner === "activity" ? "activity-wins" : "tombstone-wins",
      })
    }

    if (remoteActivity) candidateServerHashes.add(contentHash)
    if (remoteTombstone) candidateServerHashes.delete(contentHash)

    if (remoteTombstone) {
      const appliedAt = appliedTombstoneMemory.get(contentHash)
      const isFresh =
        appliedAt === undefined || remoteTombstone.deletedAt > appliedAt

      if (fromScratch) {
        // A cursor-zero walk has no prior shared history. Its tombstone is
        // historical from this device's point of view and must not delete a
        // local re-import. Uploading is deliberately not cursor-blocking:
        // without a server row, a failed upload remains discoverable locally.
        if (local && !ignoredHashes.has(contentHash)) {
          intents.push({
            type: "upload",
            intentId: makeIntentId("upload", contentHash),
            contentHash,
            activity: copyLocal(local),
            reason: "resurrect",
            requiresCursor: false,
          })
        } else if (local) {
          intents.push({
            type: "keep-local-only",
            intentId: makeIntentId("keep-local-only", contentHash),
            contentHash,
            localId: local.id,
            reason: "ignored-hash",
          })
        } else {
          intents.push({
            type: "no-op",
            intentId: makeIntentId("no-op", contentHash),
            contentHash,
            reason: "historical-tombstone",
          })
        }
        continue
      }

      if (isFresh) {
        intents.push({
          type: "apply-remote-tombstone",
          intentId: makeIntentId("apply-remote-tombstone", contentHash),
          contentHash,
          localId: local?.id,
          deletedAt: remoteTombstone.deletedAt,
          reason: "fresh-tombstone",
        })
      } else if (local && ignoredHashes.has(contentHash)) {
        intents.push({
          type: "keep-local-only",
          intentId: makeIntentId("keep-local-only", contentHash),
          contentHash,
          localId: local.id,
          reason: "ignored-hash",
        })
      } else if (local) {
        // A local copy seen after the tombstone is a deliberate re-import.
        // The tombstone has already been applied, so this is the resurrection
        // attempt and must not be deleted again on an inclusive replay.
        intents.push({
          type: "upload",
          intentId: makeIntentId("upload", contentHash),
          contentHash,
          activity: copyLocal(local),
          reason: "resurrect",
          requiresCursor: false,
        })
      } else {
        intents.push({
          type: "no-op",
          intentId: makeIntentId("no-op", contentHash),
          contentHash,
          reason: "replayed-tombstone",
        })
      }
      continue
    }

    if (remoteActivity) {
      if (ignoredHashes.has(contentHash)) {
        intents.push({
          type: "keep-local-only",
          intentId: makeIntentId("keep-local-only", contentHash),
          contentHash,
          localId: local?.id,
          reason: "ignored-hash",
        })
        continue
      }

      if (!local) {
        intents.push({
          type: "download",
          intentId: makeIntentId("download", contentHash),
          contentHash,
          remote: copyRemote(remoteActivity),
          reason: "remote-only",
        })
        continue
      }

      const differingFields = differingMetadataFields(local, remoteActivity)
      if (differingFields.length === 0) {
        intents.push({
          type: "no-op",
          intentId: makeIntentId("no-op", contentHash),
          contentHash,
          localId: local.id,
          reason: "already-present",
        })
        continue
      }

      if (fromScratch) {
        const conflict: MetadataConflict = {
          kind: "metadata",
          contentHash,
          fields: differingFields,
          resolution: "local-wins-from-scratch",
        }
        conflicts.push(conflict)
        intents.push({
          type: "upload",
          intentId: makeIntentId("upload", contentHash),
          contentHash,
          activity: copyLocal(local),
          reason: "local-wins-from-scratch",
          requiresCursor: true,
        })
        continue
      }

      const localDerivedSunPhase =
        local.startSunPhase !== undefined &&
        remoteActivity.startSunPhase === undefined
      const resolution: MetadataConflictResolution = localDerivedSunPhase
        ? "local-derived-sun-phase-wins"
        : "remote-wins-incremental"
      const conflict: MetadataConflict = {
        kind: "metadata",
        contentHash,
        fields: differingFields,
        resolution,
      }
      conflicts.push(conflict)

      if (localDerivedSunPhase) {
        intents.push({
          type: "upload",
          intentId: makeIntentId("upload", contentHash),
          contentHash,
          activity: copyLocal(local),
          reason: "backfill-sun-phase",
          requiresCursor: true,
        })
      } else {
        intents.push({
          type: "apply-remote-metadata",
          intentId: makeIntentId("apply-remote-metadata", contentHash),
          contentHash,
          localId: local.id,
          remote: copyRemote(remoteActivity),
          reason: "remote-wins-incremental",
        })
      }
      continue
    }

    if (!local) continue

    if (ignoredHashes.has(contentHash)) {
      intents.push({
        type: "keep-local-only",
        intentId: makeIntentId("keep-local-only", contentHash),
        contentHash,
        localId: local.id,
        reason: "ignored-hash",
      })
    } else if (baseKnownServerHashes.has(contentHash)) {
      intents.push({
        type: "no-op",
        intentId: makeIntentId("no-op", contentHash),
        contentHash,
        localId: local.id,
        reason: "known-remote",
      })
    } else {
      intents.push({
        type: "upload",
        intentId: makeIntentId("upload", contentHash),
        contentHash,
        activity: copyLocal(local),
        reason: "local-only",
        requiresCursor: false,
      })
    }
  }

  if (
    intents.length === 0 &&
    remote.activities.length === 0 &&
    remote.deletions.length === 0
  ) {
    intents.push({
      type: "no-op",
      intentId: makeIntentId("no-op", "empty-window"),
      reason: "empty-window",
    })
  }

  intents.sort(compareIntent)
  conflicts.sort(compareConflict)

  const required = requiredIntentIds(intents)
  const cursor: CursorIntent =
    remote.cursor === since
      ? {
          type: "hold",
          at: since,
          reason: "replayed-final-window",
        }
      : {
          type: "advance",
          from: since,
          to: remote.cursor,
          requiresIntentIds: required,
          reason: remote.hasMore ? "page-applied" : "window-applied",
        }

  const appliedTombstones = Object.entries(
    Object.fromEntries(candidateAppliedTombstones)
  )
    .sort(([a], [b]) => compareStableText(a, b))
    .reduce<Record<string, number>>((result, [hash, deletedAt]) => {
      result[hash] = deletedAt
      return result
    }, {})

  const nextState: PlannedSyncState = {
    cursor: cursor.type === "advance" ? cursor.to : state.cursor,
    serverHashes: [...candidateServerHashes].sort(compareStableText),
    ignoredHashes: [...ignoredHashes].sort(compareStableText),
    appliedTombstones,
  }

  return {
    intents,
    conflicts,
    cursor,
    nextState,
    diagnostics: [],
  }
}

/** Short integration-friendly name for callers that already say “sync”. */
export const planSync = planActivitySync
