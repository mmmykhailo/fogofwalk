import { PageSection } from "~/components/PageSection"

export function RemovingSection() {
  return (
    <PageSection title="Removing things">
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          There are three different ways to remove data, and they do genuinely
          different things — worth knowing before you pick one.
        </p>
        <ul className="ml-4 list-disc space-y-2">
          <li>
            <strong className="text-foreground">Delete one track</strong> (trash
            button in the stats panel) — removes that activity from this device.
            If you are signed in for sync, the confirmation includes a{" "}
            <em>delete from the server too</em> switch, which is on by default
            and also removes it from your other devices. Turn it off to keep the
            server copy and only stop this device from showing it.
          </li>
          <li>
            <strong className="text-foreground">Clear all</strong> (in the menu)
            — wipes every track, photo and the fog from{" "}
            <strong className="text-foreground">this device only</strong>. It
            deliberately leaves the server untouched, so if you are signed in
            your tracks will download again on the next sync. Photos are not
            synced, so those are gone for good.
          </li>
          <li>
            <strong className="text-foreground">Remove all</strong> (in the
            account dialog) — deletes your tracks from the server. Your other
            devices keep the copies they already have; they simply stop syncing
            them. Below it, <em>delete account</em> erases your account
            server-side entirely.
          </li>
        </ul>
        <p>
          In short: <em>Clear all</em> is a local reset and is undone by sync;{" "}
          <em>Remove all</em> is the server-side one. Neither is recoverable,
          and both ask you to confirm first.
        </p>
      </div>
    </PageSection>
  )
}
