import type { ParsedActivity } from "~/types/activities"
import type { ActivityMetadataPatch } from "~/lib/activities/libraryEvents"
import type { SyncOutboxItemInput } from "./repository"
import { getAuthState } from "../authStore"

export interface LocalActivityUploadPayload {
  kind: "upload"
  source: "local"
  intentId: string
  contentHash: string
  activityId: string
  libraryRevision: number
}

export interface LocalActivityDeletePayload {
  kind: "local-delete"
  source: "local"
  intentId: string
  contentHash: string
  libraryRevision: number
}

export type LocalActivityMetadataFields = Omit<ActivityMetadataPatch, "id">

export interface LocalActivityMetadataPayload {
  kind: "local-metadata"
  source: "local"
  intentId: string
  activityId: string
  contentHash: string
  patch: LocalActivityMetadataFields
  libraryRevision: number
}

function currentAccountId(): string | undefined {
  const auth = getAuthState()
  return auth.status === "signedIn" ? auth.user.id : undefined
}

export function createActivityUploadOutboxItem(
  activity: ParsedActivity,
  operationId: string,
  libraryRevision: number
): SyncOutboxItemInput | null {
  if (!activity.contentHash) return null
  const intentId = `local-upload:${operationId}:${activity.contentHash}`
  const accountId = currentAccountId()
  return {
    ...(accountId ? { accountId } : {}),
    dedupeKey: `activity:local-upload:${operationId}:${activity.contentHash}`,
    operation: "upload",
    payload: {
      kind: "upload",
      source: "local",
      intentId,
      contentHash: activity.contentHash,
      activityId: activity.id,
      libraryRevision,
    } satisfies LocalActivityUploadPayload,
  }
}

export function createActivityDeleteOutboxItem(
  activity: ParsedActivity,
  operationId: string,
  libraryRevision: number
): SyncOutboxItemInput | null {
  if (!activity.contentHash) return null
  const intentId = `local-delete:${operationId}:${activity.contentHash}`
  const accountId = currentAccountId()
  return {
    ...(accountId ? { accountId } : {}),
    dedupeKey: `activity:local-delete:${operationId}:${activity.contentHash}`,
    operation: "delete",
    payload: {
      kind: "local-delete",
      source: "local",
      intentId,
      contentHash: activity.contentHash,
      libraryRevision,
    } satisfies LocalActivityDeletePayload,
  }
}

const METADATA_FIELDS = [
  "name",
  "isPublic",
  "activityType",
  "startSunPhase",
] as const

function metadataFieldGroup(patch: ActivityMetadataPatch): string {
  return METADATA_FIELDS.filter((field) => field in patch).join("+")
}

/** Build one compact, content-addressed effect per metadata field group. */
export function createActivityMetadataOutboxItems(
  activities: readonly ParsedActivity[],
  patches: readonly ActivityMetadataPatch[],
  operationId: string,
  libraryRevision: number
): SyncOutboxItemInput[] {
  const activityById = new Map(
    activities.map((activity) => [activity.id, activity])
  )
  return patches.flatMap((patch) => {
    const activity = activityById.get(patch.id)
    if (!activity?.contentHash) return []
    const fieldGroup = metadataFieldGroup(patch)
    if (!fieldGroup) return []
    const { id: _id, ...metadataPatch } = patch
    const intentId = `local-metadata:${operationId}:${activity.id}:${fieldGroup}`
    const accountId = currentAccountId()
    return [
      {
        ...(accountId ? { accountId } : {}),
        dedupeKey: `activity:local-metadata:${activity.contentHash}:${fieldGroup}`,
        operation: "metadata" as const,
        payload: {
          kind: "local-metadata",
          source: "local",
          intentId,
          activityId: activity.id,
          contentHash: activity.contentHash,
          patch: metadataPatch,
          libraryRevision,
        } satisfies LocalActivityMetadataPayload,
      },
    ]
  })
}

export function isLocalActivityEffectPayload(
  payload: unknown
): payload is
  | LocalActivityUploadPayload
  | LocalActivityDeletePayload
  | LocalActivityMetadataPayload {
  if (!payload || typeof payload !== "object") return false
  const candidate = payload as Partial<
    LocalActivityUploadPayload | LocalActivityDeletePayload
  >
  return (
    candidate.source === "local" &&
    typeof candidate.intentId === "string" &&
    typeof candidate.contentHash === "string" &&
    (candidate.kind === "upload" ||
      candidate.kind === "local-delete" ||
      candidate.kind === "local-metadata")
  )
}

export function hasLocalActivityEffectSource(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { source?: unknown }).source === "local"
  )
}
