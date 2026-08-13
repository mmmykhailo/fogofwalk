import { Button } from "~/components/ui/button"
import { DialogFooter } from "~/components/ui/dialog"
import { DeleteAccountBlock } from "./DeleteAccountBlock"

interface AccountDialogFooterProps {
  isPurgeConfirmOpen: boolean
  isDeleteConfirmOpen: boolean
  isSigningOut: boolean
  isOffline: boolean
  onSignOut: () => void
  onDeleteOpen: () => void
  onDeleteCancel: () => void
  onDeleted: () => void
}

export function AccountDialogFooter({
  isPurgeConfirmOpen,
  isDeleteConfirmOpen,
  isSigningOut,
  isOffline,
  onSignOut,
  onDeleteOpen,
  onDeleteCancel,
  onDeleted,
}: AccountDialogFooterProps) {
  if (isPurgeConfirmOpen) {
    return null
  }

  if (isDeleteConfirmOpen) {
    return (
      <DeleteAccountBlock onCancel={onDeleteCancel} onDeleted={onDeleted} />
    )
  }

  return (
    <DialogFooter>
      <Button variant="outline" onClick={onSignOut} disabled={isSigningOut}>
        {isSigningOut ? "Logging out…" : "Log out"}
      </Button>
      <Button
        variant="destructive"
        onClick={onDeleteOpen}
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
  )
}
