import type { ParsedActivity } from "~/types/activities"
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

export function isLocalActivityEffectPayload(
  payload: unknown
): payload is LocalActivityUploadPayload | LocalActivityDeletePayload {
  if (!payload || typeof payload !== "object") return false
  const candidate = payload as Partial<
    LocalActivityUploadPayload | LocalActivityDeletePayload
  >
  return (
    candidate.source === "local" &&
    typeof candidate.intentId === "string" &&
    typeof candidate.contentHash === "string" &&
    (candidate.kind === "upload" || candidate.kind === "local-delete")
  )
}

export function hasLocalActivityEffectSource(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { source?: unknown }).source === "local"
  )
}
