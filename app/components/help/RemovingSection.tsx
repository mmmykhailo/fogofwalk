import { HelpSubheading } from "~/components/help/HelpSubheading"

/** See the note on `TROUBLESHOOTING_ITEMS` — same single-source arrangement. */
export const REMOVAL_KINDS: {
  id: string
  title: string
  where: string
  body: React.ReactNode
}[] = [
  {
    id: "delete-activity",
    title: "Delete one activity",
    where: "trash button in the stats panel",
    body: (
      <>
        Removes that activity from this device. If you are signed in for sync,
        the confirmation includes a <em>delete from the server too</em> switch,
        which is on by default and also removes it from your other devices. Turn
        it off to keep the server copy and only stop this device from showing
        it.
      </>
    ),
  },
  {
    id: "clear-all",
    title: "Clear all",
    where: "in the menu",
    body: (
      <>
        Wipes every activity, photo and the fog from{" "}
        <strong className="text-foreground">this device only</strong>. It
        deliberately leaves the server untouched, so if you are signed in your
        activities will download again on the next sync. Photos are not synced,
        so those are gone for good.
      </>
    ),
  },
  {
    id: "remove-all",
    title: "Remove all",
    where: "in the account dialog",
    body: (
      <>
        Deletes your activities from the server. Your other devices keep the
        copies they already have; they simply stop syncing them. Below it,{" "}
        <em>delete account</em> erases your account server-side entirely.
      </>
    ),
  },
]

export function RemovingSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        There are three different ways to remove data, and they do genuinely
        different things — worth knowing before you pick one.
      </p>
      <div className="space-y-4">
        {REMOVAL_KINDS.map(({ id, title, where, body }) => (
          <div key={id}>
            <HelpSubheading id={id}>
              {title}{" "}
              <span className="font-normal text-muted-foreground">
                ({where})
              </span>
            </HelpSubheading>
            <p>{body}</p>
          </div>
        ))}
      </div>
      <p>
        In short: <em>Clear all</em> is a local reset and is undone by sync;{" "}
        <em>Remove all</em> is the server-side one. Neither is recoverable, and
        both ask you to confirm first.
      </p>
    </div>
  )
}
