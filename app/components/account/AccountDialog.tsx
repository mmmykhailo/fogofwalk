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
import { friendlyMessage } from "~/lib/server/apiClient"
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
  const [error, setError] = useState<string | null>(null)

  // Never reopen onto a half-finished destructive flow.
  useEffect(() => {
    if (!open) {
      setIsDeleteConfirmOpen(false)
      setIsPurgeConfirmOpen(false)
      setPurgedCount(null)
      setError(null)
    }
  }, [open])

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
                className="text-xs break-words text-muted-foreground"
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

        {auth.canSync && !isOffline && !isDeleteConfirmOpen && (
          <div className="flex items-center gap-3 p-3 ring-1 ring-foreground/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Server storage</p>
              <p className="text-xs text-muted-foreground">
                {purgedCount === null
                  ? "Remove every track from the server, keep your account"
                  : `Removed ${purgedCount} track${purgedCount === 1 ? "" : "s"} from the server`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPurgeConfirmOpen(true)}
              disabled={isPurgeConfirmOpen}
            >
              Remove all
            </Button>
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

        {error && <p className="text-xs text-destructive">{error}</p>}

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
