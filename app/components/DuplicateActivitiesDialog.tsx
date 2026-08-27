import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog"

interface DuplicateActivitiesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  duplicateCount: number
}

/**
 * Shown when an import added nothing because every activity was already on the
 * map. Without it the app looks broken: the files are accepted, the dialog
 * closes and the map is unchanged.
 *
 * Activities are matched on their content hash, so a renamed copy of a file counts
 * as the same activity.
 */
export function DuplicateActivitiesDialog({
  open,
  onOpenChange,
  duplicateCount,
}: DuplicateActivitiesDialogProps) {
  const isSingle = duplicateCount === 1
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isSingle ? "Activity already added" : "Activities already added"}
          </DialogTitle>
          <DialogDescription>
            {isSingle
              ? "That activity is already on your map, so nothing changed."
              : `All ${duplicateCount} activities are already on your map, so nothing changed.`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs/relaxed text-muted-foreground">
          Activities are matched on their contents, not their file name — a
          renamed or re-exported copy of the same activity counts as the same
          activity.
        </p>
      </DialogContent>
    </Dialog>
  )
}
