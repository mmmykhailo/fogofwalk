import { ACTIVITY_TYPE_LABELS } from "~/lib/activityType"
import type { ActivityType } from "~/types/activities"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
export type BulkActivityUpdateProposal =
  | { setting: "publicity"; value: boolean }
  | { setting: "activityType"; value: ActivityType }

interface ConfirmBulkActivityUpdateDialogProps {
  open: boolean
  activityCount: number
  proposal: BulkActivityUpdateProposal | null
  isSubmitting: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function proposalTarget(proposal: BulkActivityUpdateProposal): string {
  if (proposal.setting === "publicity") {
    return proposal.value ? "public" : "private"
  }
  return ACTIVITY_TYPE_LABELS[proposal.value]
}

function proposalTitle(
  proposal: BulkActivityUpdateProposal,
  activityCount: number
): string {
  const noun = `${activityCount} activit${activityCount === 1 ? "y" : "ies"}`
  return proposal.setting === "publicity"
    ? `Make ${noun} ${proposalTarget(proposal)}?`
    : `Change ${noun} to ${proposalTarget(proposal)}?`
}

export function ConfirmBulkActivityUpdateDialog({
  open,
  activityCount,
  proposal,
  isSubmitting,
  error,
  onOpenChange,
  onConfirm,
}: ConfirmBulkActivityUpdateDialogProps) {
  if (!proposal) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>{proposalTitle(proposal, activityCount)}</DialogTitle>
          <DialogDescription>
            This changes the selected activities together. You can keep your
            selection afterward.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={isSubmitting} onClick={onConfirm}>
            {isSubmitting ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
