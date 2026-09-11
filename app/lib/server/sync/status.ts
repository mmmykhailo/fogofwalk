import { useSyncExternalStore } from "react"
import type { SyncOutboxItem } from "./repository"

export type SyncPhase =
  | "disabled"
  | "idle"
  | "syncing"
  | "waiting"
  | "partial"
  | "permanent"
  | "suspended"
  | "error"

export interface SyncStatus {
  phase: SyncPhase
  lastSyncAt: number | null
  message: string | null
  runId: number
  trigger: string | null
  done: number
  total: number
  retries: number
  nextRetryAt: number | null
  pendingCount: number
  retryableCount: number
  inFlightCount: number
  permanentCount: number
  cursorHeld: boolean
}

export type SyncStatusUpdate = Partial<SyncStatus>

export interface SyncOutboxSummary {
  pendingCount: number
  retryableCount: number
  inFlightCount: number
  permanentCount: number
  nextRetryAt: number | null
  retries: number
}

const emptySummary: SyncOutboxSummary = {
  pendingCount: 0,
  retryableCount: 0,
  inFlightCount: 0,
  permanentCount: 0,
  nextRetryAt: null,
  retries: 0,
}

let status: SyncStatus = {
  phase: "idle",
  lastSyncAt: null,
  message: null,
  runId: 0,
  trigger: null,
  done: 0,
  total: 0,
  retries: 0,
  nextRetryAt: null,
  pendingCount: 0,
  retryableCount: 0,
  inFlightCount: 0,
  permanentCount: 0,
  cursorHeld: false,
}

const listeners = new Set<() => void>()

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
}

export function setSyncStatus(update: SyncStatusUpdate): void {
  status = { ...status, ...update }
  for (const listener of listeners) listener()
}

export function summarizeSyncOutbox(
  items: readonly SyncOutboxItem[]
): SyncOutboxSummary {
  const summary = { ...emptySummary }
  for (const item of items) {
    if (item.status === "pending") summary.pendingCount++
    if (item.status === "retryable") {
      summary.retryableCount++
      summary.nextRetryAt =
        summary.nextRetryAt === null
          ? item.availableAt
          : Math.min(summary.nextRetryAt, item.availableAt)
    }
    if (item.status === "in-flight") summary.inFlightCount++
    if (item.status === "permanent") summary.permanentCount++
    summary.retries += item.attempts
  }
  return summary
}

export function applySyncOutboxSummary(
  summary: SyncOutboxSummary,
  update: SyncStatusUpdate = {}
): void {
  setSyncStatus({
    ...update,
    pendingCount: summary.pendingCount,
    retryableCount: summary.retryableCount,
    inFlightCount: summary.inFlightCount,
    permanentCount: summary.permanentCount,
    nextRetryAt: summary.nextRetryAt,
    retries: Math.max(summary.retries, update.retries ?? 0),
  })
}

export function describeSyncStatus(value: SyncStatus): string | null {
  if (value.phase === "disabled") return null
  if (value.phase === "suspended") {
    return value.message ?? "Sync paused — reload to resume"
  }
  if (value.phase === "syncing") {
    if (value.total === 0) return "Syncing…"
    return `Syncing ${value.done} of ${value.total}…`
  }
  if (value.phase === "waiting") {
    const message = value.message ?? "Changes are waiting to retry"
    const retry = formatRetryTime(value.nextRetryAt)
    return retry ? `${message} (${retry})` : message
  }
  if (value.phase === "partial") {
    return value.message ?? "Sync received some changes; more remain"
  }
  if (value.phase === "permanent") {
    return value.message ?? "Some changes cannot be synced"
  }
  if (value.phase === "error") return value.message ?? "Sync failed"
  if (value.pendingCount > 0 || value.retryableCount > 0) {
    return `${value.pendingCount + value.retryableCount} change${value.pendingCount + value.retryableCount === 1 ? "" : "s"} waiting to sync`
  }
  if (value.permanentCount > 0) {
    return `${value.permanentCount} change${value.permanentCount === 1 ? "" : "s"} need attention`
  }
  if (value.lastSyncAt === null) return null
  const ageMs = Date.now() - value.lastSyncAt
  if (ageMs < 60_000) return "Synced just now"
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `Synced ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Synced ${hours}h ago`
  return `Synced ${Math.floor(hours / 24)}d ago`
}

export function formatRetryTime(timestamp: number | null): string | null {
  if (timestamp === null) return null
  const remaining = timestamp - Date.now()
  if (remaining <= 0) return "next opportunity"
  const seconds = Math.ceil(remaining / 1000)
  if (seconds < 60) return `in ${seconds}s`
  return `in ${Math.ceil(seconds / 60)} min`
}
