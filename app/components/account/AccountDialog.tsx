import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { apiGet, friendlyMessage } from "~/lib/server/apiClient"
import { signOut, useAuth } from "~/lib/server/authStore"
import {
  describeSyncStatus,
  requestSync,
  useIsAutoSyncSuspended,
  useSyncStatus,
} from "~/lib/server/syncEngine"
import { useServerHealth } from "~/lib/server/serverHealth"
import { useUploadHoldNotice } from "~/lib/server/useUploadHoldNotice"
import { AccountAvatar } from "./AccountAvatar"
import { DeleteAccountBlock } from "./DeleteAccountBlock"
import { PurgeServerBlock } from "./PurgeServerBlock"
import { ServerUnavailableNotice } from "./ServerUnavailableNotice"

interface AccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function downloadFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
  const auth = useAuth()
  const syncStatus = useSyncStatus()
  const isSuspended = useIsAutoSyncSuspended()
  const health = useServerHealth(true)
  const isOffline = health === "offline"
  const holdNotice = useUploadHoldNotice()
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isPurgeConfirmOpen, setIsPurgeConfirmOpen] = useState(false)
  const [purgedCount, setPurgedCount] = useState<number | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Never reopen onto a half-finished destructive flow.
  useEffect(() => {
    if (!open) {
      setIsDeleteConfirmOpen(false)
      setIsPurgeConfirmOpen(false)
      setPurgedCount(null)
      setExportSuccess(false)
      setError(null)
    }
  }, [open])

  async function handleExport() {
    setIsExporting(true)
    setError(null)
    setExportSuccess(false)
    try {
      const response = await apiGet("/api/account/export")
      const filename = `fogofwalk-export-${new Date().toISOString().split("T")[0]}.json`
      downloadFile(response, filename)
      setExportSuccess(true)
      // Reset success message after 3 seconds
      setTimeout(() => setExportSuccess(false), 3000)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setIsExporting(false)
    }
  }

  if (auth.status !== "signedIn") return null

  async function handleSignOut() {
    setIsSigningOut(true)
    setError(null)
    try {
      await signOut()
      onOpenChange(false)
    } catch (err) {
      setError(friendlyMessage(err))
      setIsSigningOut(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your account, sync status, and server data
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <AccountAvatar
            displayName={auth.user.displayName}
            avatarUrl={auth.user.avatarUrl}
            className="size-9"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {auth.user.displayName}
            </p>
            <p className="text-xs text-muted-foreground">
              Signed in with {auth.user.provider}
            </p>
          </div>
        </div>

        {isOffline && (
          <ServerUnavailableNotice
            onRetry={() => {
              if (auth.canSync) requestSync("retry-after-offline")
            }}
          />
        )}

        {auth.canSync && !isOffline && (
          <div className="flex items-center gap-3 p-3 ring-1 ring-foreground/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Track sync</p>
              {/*
                Wraps rather than truncating: the throttle notice is a whole
                sentence with a countdown at the end, and an ellipsis would cut
                off the one number the user is waiting on. Every other status is
                short enough to stay on one line anyway.
              */}
              <p
                data-testid="sync-status"
                className="text-xs wrap-break-words text-muted-foreground"
              >
                {holdNotice ??
                  (isSuspended
                    ? "Paused after a local delete"
                    : (describeSyncStatus(syncStatus) ?? "Not synced yet"))}
              </p>
            </div>
            <Button
              data-testid="sync-now"
              variant="outline"
              size="sm"
              // The one way back: an explicit request resumes a suspension.
              onClick={() => requestSync("manual", { manual: true })}
              disabled={syncStatus.phase === "syncing"}
            >
              {syncStatus.phase === "syncing"
                ? "Syncing…"
                : isSuspended
                  ? "Resume sync"
                  : "Sync now"}
            </Button>
          </div>
        )}

        {!isDeleteConfirmOpen && (
          <div className="flex items-center gap-3 p-3 ring-1 ring-foreground/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Server storage</p>
              <p className="text-xs text-muted-foreground">
                {auth.canSync
                  ? purgedCount === null
                    ? "Remove every track from the server, keep your account"
                    : `Removed ${purgedCount} track${purgedCount === 1 ? "" : "s"} from the server`
                  : "Export the data stored on the server"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {auth.canSync && !isOffline && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsPurgeConfirmOpen(true)}
                  disabled={isPurgeConfirmOpen}
                >
                  Remove all
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isExporting || isOffline || isPurgeConfirmOpen}
                title={
                  isOffline
                    ? "Cannot export while server is unavailable"
                    : undefined
                }
              >
                {isExporting
                  ? "Exporting…"
                  : exportSuccess
                    ? "Downloaded!"
                    : "Export my data"}
              </Button>
            </div>
          </div>
        )}

        {isPurgeConfirmOpen && (
          <PurgeServerBlock
            onCancel={() => setIsPurgeConfirmOpen(false)}
            onPurged={(deleted) => {
              setPurgedCount(deleted)
              setIsPurgeConfirmOpen(false)
            }}
          />
        )}

        {!auth.canSync && !isOffline && (
          <p className="p-3 text-xs/relaxed text-muted-foreground ring-1 ring-foreground/10">
            Your account isn&rsquo;t enabled for sync yet. You&rsquo;re signed
            in, but tracks stay on this device until an admin enables it.
          </p>
        )}

        {error && <p className="text-xs text-destructive mb-2">{error}</p>}

        {isPurgeConfirmOpen ? null : isDeleteConfirmOpen ? (
          <DeleteAccountBlock
            onCancel={() => setIsDeleteConfirmOpen(false)}
            onDeleted={() => onOpenChange(false)}
          />
        ) : (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? "Logging out…" : "Log out"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setIsDeleteConfirmOpen(true)}
              // Deletion is server-side only; offer it only when it can work.
              // Logging out stays available — it just drops the local session.
              disabled={isSigningOut || isOffline}
              title={
                isOffline
                  ? "Can't delete your account while the server is unreachable"
                  : undefined
              }
            >
              Delete account
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
