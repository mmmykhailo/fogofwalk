import { useRef, useState } from "react"
import {
  CloudArrowDownIcon,
  FlaskIcon,
  UploadIcon,
} from "@phosphor-icons/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { TransitionLink } from "~/components/TransitionLink"
import { SignInDialog } from "~/components/account/SignInDialog"
import { useAuth } from "~/lib/server/authStore"

interface FileUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddFiles: (files: FileList) => void
  onLoadSampleData: () => void
}

export function FileUploadDialog({
  open,
  onOpenChange,
  onAddFiles,
  onLoadSampleData,
}: FileUploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSignInOpen, setIsSignInOpen] = useState(false)
  const auth = useAuth()

  // Only offered on a build that has a server, and only to someone not already
  // signed in — a signed-in user's tracks are already on their way down. The
  // `disabled` status is the no-server build, so this drops out of the GitHub
  // Pages deployment exactly the way `AccountDrawerItem` does.
  const canOfferSignIn = auth.status === "signedOut"

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    onAddFiles(files)
    e.target.value = ""
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Load activity files</DialogTitle>
            <DialogDescription>
              Select GPX or FIT files from your computer. The map fog will clear
              along your routes.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".gpx,.fit"
            className="hidden"
            onChange={handleFileChange}
          />
          <TransitionLink
            to="/help"
            className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            New to Fog of Walk? Learn how it works →
          </TransitionLink>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex gap-3">
              <Button
                autoFocus
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon weight="bold" className="mr-2" />
                Select files
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onLoadSampleData()
                }}
              >
                <FlaskIcon weight="bold" className="mr-2" />
                Try sample
              </Button>
            </div>
            {canOfferSignIn && (
              <Button
                variant="outline"
                onClick={() => {
                  // Two modal dialogs must not overlap: close this one first and
                  // let it finish its 100 ms exit, the same close-then-open the
                  // drawer uses for its own account dialogs.
                  onOpenChange(false)
                  setTimeout(() => setIsSignInOpen(true), 150)
                }}
              >
                <CloudArrowDownIcon weight="bold" className="mr-2" />
                Login and sync from server
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Skip for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SignInDialog open={isSignInOpen} onOpenChange={setIsSignInOpen} />
    </>
  )
}
