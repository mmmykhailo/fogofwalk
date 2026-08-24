import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { TransitionLink } from "~/components/TransitionLink"

interface MissingActivityTypeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activityCount: number
}

export function MissingActivityTypeDialog({
  open,
  onOpenChange,
  activityCount,
}: MissingActivityTypeDialogProps) {
  const isSingle = activityCount === 1
  const description = isSingle
    ? "The imported file did not include an activity type. You can categorize it manually on the My activities page."
    : activityCount +
      " imported activities did not include an activity type. You can categorize them manually on the My activities page."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose activity types</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Not now
          </DialogClose>
          <Button
            render={
              <TransitionLink
                to="/activities"
                onClick={() => onOpenChange(false)}
              />
            }
          >
            Choose types
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
