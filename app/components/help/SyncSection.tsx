import { PageSection } from "~/components/PageSection"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"

export function SyncSection() {
  return (
    <PageSection title="Syncing across devices (optional)">
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Everything described so far is local. Fog of Walk needs no account,
          and on its own it never sends your data anywhere — the fog, your
          tracks and your photos are computed and stored on the device you are
          using.
        </p>
        <p>
          On top of that, this app <em>can</em> be connected to an optional sync
          server, so the same library shows up on your phone and your laptop.
          Whether that is available depends on how the copy you are using was
          deployed:{" "}
          <strong className="text-foreground">
            if there is no Account entry in the menu, this build has no server
          </strong>{" "}
          and nothing can leave the device.
        </p>
        <p>
          <strong className="text-foreground">Where sync is available:</strong>
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            You sign in with an account you already have — the sign-in dialog
            lists whichever providers that server offers (GitHub in the default
            setup). Fog of Walk never asks you for a password of its own
          </li>
          <li>
            <strong className="text-foreground">
              Only tracks are uploaded. Photos are never uploaded
            </strong>{" "}
            — they stay on the device that imported them, which also means they
            do not appear on your other devices
          </li>
          <li>
            Once signed in, syncing happens by itself — after an import, when
            you return to the tab, and periodically while it is open
          </li>
          <li>
            The same activity imported on two devices is recognised as one,
            because tracks are identified by their contents rather than their
            filename
          </li>
          <li>
            Signing in does not automatically grant sync. On a server whose
            owner keeps an invite list you may be signed in but{" "}
            <em>not enabled for sync</em> until they add you
          </li>
          <li>
            After you delete a track locally without removing it from the
            server, sync pauses until you reload — otherwise the next sync would
            simply download it again
          </li>
        </ul>
        <Alert>
          <AlertTitle>Sync means trusting the server's operator</AlertTitle>
          <AlertDescription>
            Synced tracks are stored on the server without encryption, so
            whoever runs it can see where you have been. Only sign in if you
            trust them — or run your own server. Staying signed out keeps
            everything on your device, with no loss of features other than sync
            itself.
          </AlertDescription>
        </Alert>
      </div>
    </PageSection>
  )
}
