import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"

export function SyncSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Everything described so far is local. Fog of Walk needs no account, and
        until you sign in it never sends your data anywhere — the fog, your
        activities and your photos are computed and stored on the device you are
        using.
      </p>
      <p>
        Signing in adds an optional sync server on top of that, so the same
        library shows up on your phone and your laptop. You can open it from the{" "}
        <strong className="text-foreground">Account</strong> entry in the menu.
        It is entirely up to you: nothing leaves the device unless you sign in.
      </p>
      <p>
        <strong className="text-foreground">How sync works:</strong>
      </p>
      <ul className="ml-4 list-disc space-y-1">
        <li>
          You sign in with an account you already have — the sign-in dialog
          lists the providers the server offers. Fog of Walk never asks you for
          a password of its own
        </li>
        <li>
          <strong className="text-foreground">
            Only activities are uploaded. Photos are never uploaded
          </strong>{" "}
          — they stay on the device that imported them, which also means they do
          not appear on your other devices
        </li>
        <li>
          Once signed in, syncing happens by itself — after an import, when you
          return to the tab, and periodically while it is open
        </li>
        <li>
          The same activity imported on two devices is recognised as one,
          because activities are identified by their contents rather than their
          filename
        </li>
        <li>
          Signing in does not automatically grant sync. If the server keeps an
          invite list you may be signed in but <em>not enabled for sync</em>{" "}
          until its owner adds you
        </li>
        <li>
          After you delete an activity locally without removing it from the
          server, sync pauses until you reload — otherwise the next sync would
          simply download it again
        </li>
      </ul>
      <Alert>
        <AlertTitle>Sync means trusting the server's operator</AlertTitle>
        <AlertDescription>
          Synced activities are stored on the server without encryption, so
          whoever runs it can see where you have been. Only sign in if you trust
          them — or run your own server. Staying signed out keeps everything on
          your device, with no loss of features other than sync itself.
        </AlertDescription>
      </Alert>
    </div>
  )
}
