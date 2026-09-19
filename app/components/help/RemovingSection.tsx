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
    id: "clear-activities",
    title: "Clear activities",
    where: "in the menu",
    body: (
      <>
        Removes every activity and resets the fog from{" "}
        <strong className="text-foreground">this device only</strong>. Photos
        and saved points are preserved. It deliberately leaves server activity
        copies untouched, so if you are signed in they can download again when
        sync resumes. To delete those server copies too, use <em>Remove all</em>{" "}
        in the account dialog.
      </>
    ),
  },
  {
    id: "clear-photos",
    title: "Clear photos",
    where: "in the menu",
    body: (
      <>
        Permanently removes every photo from{" "}
        <strong className="text-foreground">this device only</strong>. Photos
        are local-only and cannot be recovered. Activities, fog, saved points,
        and sync state are not changed.
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
        copies they already have; they simply stop syncing them. Saved points
        are not affected by this activity-only action. Below it,{" "}
        <em>delete account</em> erases the account and all of its server-side
        activities and saved points.
      </>
    ),
  },
]

export function RemovingSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        There are four different ways to remove data, and they do genuinely
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
        In short: <em>Clear activities</em> is a local activity reset whose
        synced data can return; <em>Clear photos</em> is permanent and local;
        <em>Remove all</em> deletes only the server's activity copies. Each
        destructive action asks you to confirm first.
      </p>
    </div>
  )
}
