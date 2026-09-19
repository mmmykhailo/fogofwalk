import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"

interface ClearPhotosDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photoCount: number
  onConfirm: () => void
}

export function ClearPhotosDialog({
  open,
  onOpenChange,
  photoCount,
  onConfirm,
}: ClearPhotosDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Clear photos?</DialogTitle>
          <DialogDescription>
            All {photoCount} photo{photoCount !== 1 ? "s" : ""} will be
            permanently removed from this device. Photos are local-only and
            cannot be recovered. Activities, fog, and saved points will not be
            changed.
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
            Clear photos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
