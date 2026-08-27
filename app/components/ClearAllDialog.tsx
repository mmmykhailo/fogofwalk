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

interface ClearAllDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activityCount: number
  photoCount: number
  onConfirm: () => void
}

export function ClearAllDialog({
  open,
  onOpenChange,
  activityCount,
  photoCount,
  onConfirm,
}: ClearAllDialogProps) {
  const auth = useAuth()
  const isSynced = auth.status === "signedIn" && auth.canSync

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Clear all data?</DialogTitle>
          <DialogDescription>
            All {activityCount} activity{activityCount !== 1 ? "s" : ""}
            {photoCount > 0
              ? ` and ${photoCount} photo${photoCount !== 1 ? "s" : ""}`
              : ""}{" "}
            will be removed from this device and the fog map will be reset.
            {photoCount > 0 &&
              " Photos are not synced — those are gone for good."}
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
            Clear all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
