import { Button } from "~/components/ui/button"
import { useAuth } from "~/lib/server/authStore"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"

interface ClearActivitiesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activityCount: number
  onConfirm: () => void
}

export function ClearActivitiesDialog({
  open,
  onOpenChange,
  activityCount,
  onConfirm,
}: ClearActivitiesDialogProps) {
  const auth = useAuth()
  const isSynced = auth.status === "signedIn" && auth.canSync

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Clear activities?</DialogTitle>
          <DialogDescription>
            All {activityCount} activit{activityCount !== 1 ? "ies" : "y"} will
            be removed from this device and the fog map will be reset. Photos
            and saved points will be preserved.
          </DialogDescription>
        </DialogHeader>

        {isSynced && (
          <p className="p-3 text-xs/relaxed text-muted-foreground ring-1 ring-foreground/10">
            Your activities stay on the server and will sync back to this
            device. To delete them there as well, use{" "}
            <strong>Remove all</strong> in your account.
          </p>
        )}
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
            Clear activities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
