import { PageSection } from "~/components/PageSection"
import { Badge } from "~/components/ui/badge"
import { InlineCode } from "~/components/help/InlineCode"

const STEPS = [
  {
    title: "Import activity files",
    body: (
      <>
        upload <InlineCode>.gpx</InlineCode> or <InlineCode>.fit</InlineCode>{" "}
        files from your device. Multiple files are supported; you can add more
        at any time.
      </>
    ),
  },
  {
    title: "Fog clears along your routes",
    body: (
      <>
        everything within <strong className="text-foreground">100 m</strong> of
        your route is revealed — that is 100 m to each side, so a corridor about
        200 m wide. Enable <em>Fill loops</em> to also clear the interior of
        closed loops (e.g. a park circuit).
      </>
    ),
  },
  {
    title: "Add photos (optional)",
    body: (
      <>
        upload photos taken during your activities. They appear as markers on
        the map at the location where you were when the photo was taken, matched
        by timestamp.
      </>
    ),
  },
  {
    title: "Explore, measure, share",
    body: (
      <>
        tap a track for its stats and elevation profile, open the statistics
        page for lifetime totals and streaks, and turn any activity into a
        shareable image.
      </>
    ),
  },
  {
    title: "Your data stays on your device",
    body: (
      <>
        tracks, photos and the fog itself are stored in your browser. No account
        is needed and nothing is uploaded by default. Optional cloud sync exists
        for people who want their tracks on more than one device — see{" "}
        <em>Syncing across devices</em> below.
      </>
    ),
  },
]

export function WorkflowSection() {
  return (
    <PageSection title="Workflow">
      <ol className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {STEPS.map(({ title, body }, i) => (
          <li key={title} className="flex gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {i + 1}
            </Badge>
            <span>
              <strong className="text-foreground">{title}</strong> — {body}
            </span>
          </li>
        ))}
      </ol>
    </PageSection>
  )
}
