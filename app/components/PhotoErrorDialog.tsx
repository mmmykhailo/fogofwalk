import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog"
import { TransitionLink } from "~/components/TransitionLink"

interface PhotoErrorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhotoErrorDialog({
  open,
  onOpenChange,
}: PhotoErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>No photos were added</DialogTitle>
          <DialogDescription>
            None of the selected photos could be matched to your activities.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Common reasons:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              No activities loaded yet — add GPX or FIT files first
            </li>
            <li>
              Photos have no timestamp (screenshots or heavily edited photos
              often lose EXIF data)
            </li>
            <li>
              Photos were taken more than 5 minutes away from any recorded
              activity point
            </li>
          </ul>
          <p>
            See the{" "}
            <TransitionLink
              to="/help"
              className="underline underline-offset-2 hover:text-foreground"
            >
              help page
            </TransitionLink>{" "}
            for more details.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
