import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"
import { Switch } from "~/components/ui/switch"
import { useAuth } from "~/lib/server/authStore"

interface DeleteTrackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trackName: string
  /**
   * `alsoOnServer` is meaningful only when the track is synced; it is false
   * whenever the sync server is absent or the user is signed out.
   */
  onConfirm: (alsoOnServer: boolean) => void
}

export function DeleteTrackDialog({
  open,
  onOpenChange,
  trackName,
  onConfirm,
}: DeleteTrackDialogProps) {
  const auth = useAuth()
  const isSynced = auth.status === "signedIn" && auth.canSync
  // Defaults on: "delete" normally means everywhere, and a track that came
  // back on the next sync would look like the delete had failed.
  const [isAlsoOnServer, setIsAlsoOnServer] = useState(true)

  useEffect(() => {
    if (open) setIsAlsoOnServer(true)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this track?</DialogTitle>
          <DialogDescription>
            &ldquo;{trackName}&rdquo; will be removed and the fog map will be
            recalculated. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {isSynced && (
          <div className="flex items-start gap-3 p-3 ring-1 ring-foreground/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Delete from the server too</p>
              <p className="text-xs/relaxed text-muted-foreground">
                {isAlsoOnServer
                  ? "It will also disappear from your other devices."
                  : "The server copy is kept. This device won't download it again."}
              </p>
            </div>
            <Switch
              checked={isAlsoOnServer}
              onCheckedChange={setIsAlsoOnServer}
              aria-label="Delete from the server too"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm(isSynced && isAlsoOnServer)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
