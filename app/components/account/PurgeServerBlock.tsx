import { useState } from "react"
import { Button } from "~/components/ui/button"
import { friendlyMessage } from "~/lib/server/apiClient"
import { purgeServerActivities } from "~/lib/server/syncEngine"

interface PurgeServerBlockProps {
  onCancel: () => void
  onPurged: (deleted: number) => void
}

/**
 * Second verification for wiping the server's copy of every activity, in place
 * inside the account dialog — same reasoning as `DeleteAccountBlock`: a nested
 * dialog opened from a vaul drawer is the combination this codebase carries
 * focus workarounds for.
 *
 * Distinct from deleting the account, and distinct from "Clear all": no
 * tombstones are written, so nothing on any device is deleted.
 */
export function PurgeServerBlock({
  onCancel,
  onPurged,
}: PurgeServerBlockProps) {
  const [isPurging, setIsPurging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setIsPurging(true)
    setError(null)
    try {
      onPurged(await purgeServerActivities())
    } catch (err) {
      setError(friendlyMessage(err))
      setIsPurging(false)
    }
  }

  return (
    <div className="space-y-2 p-3 ring-1 ring-destructive/30">
      <p className="text-sm font-medium text-destructive">
        Remove all activities from the server?
      </p>
      <p className="text-xs/relaxed text-muted-foreground">
        Every activity stored on the server is deleted and your account stays.
        Nothing is removed from this device or from your other devices — they
        simply stop syncing the activities they already have. New activities you
        import afterwards will sync as normal.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isPurging}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleConfirm}
          disabled={isPurging}
        >
          {isPurging ? "Removing…" : "Remove from server"}
        </Button>
      </div>
    </div>
  )
}
