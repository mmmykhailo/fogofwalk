import {
  describeSyncStatus,
  useIsAutoSyncSuspended,
  useSyncStatus,
} from "~/lib/server/syncEngine"
import { useUploadHoldNotice } from "~/lib/server/useUploadHoldNotice"

interface SyncAction {
  statusLabel: string
  buttonLabel: string
  isSyncing: boolean
}

export function useSyncAction(): SyncAction {
  const syncStatus = useSyncStatus()
  const isSuspended = useIsAutoSyncSuspended()
  const holdNotice = useUploadHoldNotice()

  let statusLabel: string
  if (holdNotice != null) {
    statusLabel = holdNotice
  } else if (isSuspended) {
    statusLabel = "Paused after a local delete"
  } else {
    statusLabel = describeSyncStatus(syncStatus) ?? "Not synced yet"
  }

  let buttonLabel: string
  if (syncStatus.phase === "syncing") {
    buttonLabel = "Syncing…"
  } else if (isSuspended) {
    buttonLabel = "Resume sync"
  } else {
    buttonLabel = "Sync now"
  }

  return {
    statusLabel,
    buttonLabel,
    isSyncing: syncStatus.phase === "syncing",
  }
}
