import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import type { ImportFailureSummary } from "~/lib/activities/import/service"

interface ParseErrorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  failedFiles: string[]
  failureDetails?: ImportFailureSummary[]
  canRetry?: boolean
  onRetry?: () => void
  onDiscard?: () => void
}

export function ParseErrorDialog({
  open,
  onOpenChange,
  failedFiles,
  failureDetails = [],
  canRetry = false,
  onRetry,
  onDiscard,
}: ParseErrorDialogProps) {
  const storageFailure = failureDetails.some((failure) =>
    failure.errorCode?.startsWith("storage-")
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {storageFailure
              ? "Activity import could not be saved"
              : failedFiles.length === 1
                ? "1 file could not be read"
                : `${failedFiles.length} files could not be read`}
          </DialogTitle>
          <DialogDescription>
            {storageFailure
              ? "Nothing from the failed save was added. Check browser storage and try the import again."
              : `The following file${failedFiles.length !== 1 ? "s" : ""} contained no valid activities and ${failedFiles.length !== 1 ? "were" : "was"} skipped:`}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 max-w-full space-y-1 overflow-auto rounded bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
          {failedFiles.map((name) => (
            <li key={name} className="space-y-0.5">
              <div className="whitespace-nowrap">{name}</div>
              {failureDetails.find((failure) => failure.name === name)
                ?.error && (
                <div className="font-sans text-xs/relaxed whitespace-normal text-destructive">
                  {
                    failureDetails.find((failure) => failure.name === name)
                      ?.error
                  }
                </div>
              )}
            </li>
          ))}
        </ul>
        {!storageFailure && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Common reasons:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>File is corrupted or incompletely downloaded</li>
              <li>GPX file has malformed XML or missing activity segments</li>
              <li>
                FIT file is from an unsupported device or firmware version
              </li>
            </ul>
          </div>
        )}
        {canRetry && (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onDiscard}>
              Discard shared files
            </Button>
            <Button onClick={onRetry}>Try again</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
