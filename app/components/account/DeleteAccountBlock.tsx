import { useState } from "react"
import { Button } from "~/components/ui/button"
import { friendlyMessage } from "~/lib/server/apiClient"
import { deleteAccount } from "~/lib/server/authStore"

interface DeleteAccountBlockProps {
  onCancel: () => void
  onDeleted: () => void
}

/**
 * Second verification for account deletion, rendered **in place** inside the
 * account dialog rather than as a nested dialog.
 *
 * A nested Base UI dialog opened from inside a vaul drawer is the exact
 * combination this codebase already carries three focus workarounds for (see
 * the drawer note in CLAUDE.md). Confirming inline sidesteps that entirely.
 */
export function DeleteAccountBlock({
  onCancel,
  onDeleted,
}: DeleteAccountBlockProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setIsDeleting(true)
    setError(null)
    try {
      await deleteAccount()
      onDeleted()
    } catch (err) {
      setError(friendlyMessage(err))
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-2 p-3 ring-1 ring-destructive/30">
      <p className="text-sm font-medium text-destructive">
        Delete your account?
      </p>
      <p className="text-xs/relaxed text-muted-foreground">
        Your account, your sign-in and every track synced to the server will be
        permanently deleted. Tracks already on this device stay where they are.
        This cannot be undone.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>
    </div>
  )
}
