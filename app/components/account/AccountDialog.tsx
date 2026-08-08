import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { friendlyMessage } from "~/lib/server/apiClient"
import { signOut, useAuth } from "~/lib/server/authStore"
import {
  describeSyncStatus,
  requestSync,
  useSyncStatus,
} from "~/lib/server/syncEngine"
import { useServerHealth } from "~/lib/server/serverHealth"
import { AccountAvatar } from "./AccountAvatar"
import { DeleteAccountBlock } from "./DeleteAccountBlock"
import { ServerUnavailableNotice } from "./ServerUnavailableNotice"

interface AccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
  const auth = useAuth()
  const syncStatus = useSyncStatus()
  const health = useServerHealth(true)
  const isOffline = health === "offline"
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Never reopen onto a half-finished destructive flow.
  useEffect(() => {
    if (!open) {
      setIsDeleteConfirmOpen(false)
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
              <p className="truncate text-xs text-muted-foreground">
                {describeSyncStatus(syncStatus) ?? "Not synced yet"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestSync("manual")}
              disabled={syncStatus.phase === "syncing"}
            >
              {syncStatus.phase === "syncing" ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        )}

        {!auth.canSync && !isOffline && (
          <p className="p-3 text-xs/relaxed text-muted-foreground ring-1 ring-foreground/10">
            Your account isn&rsquo;t enabled for sync yet. You&rsquo;re signed
            in, but tracks stay on this device until an admin enables it.
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {isDeleteConfirmOpen ? (
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
