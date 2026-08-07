import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"

interface DeleteTrackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trackName: string
  onConfirm: () => void
}

export function DeleteTrackDialog({
  open,
  onOpenChange,
  trackName,
  onConfirm,
}: DeleteTrackDialogProps) {
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
