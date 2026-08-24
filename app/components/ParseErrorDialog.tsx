import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog"

interface ParseErrorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  failedFiles: string[]
}

export function ParseErrorDialog({
  open,
  onOpenChange,
  failedFiles,
}: ParseErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {failedFiles.length === 1
              ? "1 file could not be read"
              : `${failedFiles.length} files could not be read`}
          </DialogTitle>
          <DialogDescription>
            The following file{failedFiles.length !== 1 ? "s" : ""} contained no
            valid activities and {failedFiles.length !== 1 ? "were" : "was"}{" "}
            skipped:
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 max-w-full space-y-1 overflow-auto rounded bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
          {failedFiles.map((name) => (
            <li key={name} className="whitespace-nowrap">
              {name}
            </li>
          ))}
        </ul>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Common reasons:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>File is corrupted or incompletely downloaded</li>
            <li>GPX file has malformed XML or missing activity segments</li>
            <li>FIT file is from an unsupported device or firmware version</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
