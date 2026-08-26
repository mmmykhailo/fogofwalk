import { Badge } from "~/components/ui/badge"

/** Anchor targets for the nested contents entries; see `sections.ts`. */
export const FILE_FORMAT_ANCHORS = [
  { id: "format-gpx", title: "GPX" },
  { id: "format-fit", title: "FIT" },
]

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { InlineCode } from "~/components/help/InlineCode"

export function FileFormatsSection() {
  return (
    <>
      <Card id="format-gpx" className="mb-4 scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge className="text-base">GPX</Badge>
            <span className="text-sm font-normal text-muted-foreground">
              GPS Exchange Format
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The most common GPS format. Exported by nearly every fitness app.
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Strava</strong> — Activity
              page → ⋯ → Export GPX
            </li>
            <li>
              <strong className="text-foreground">Garmin Connect</strong> —
              Activity → ⋯ → Export Original (or Export GPX)
            </li>
            <li>
              <strong className="text-foreground">AllTrails</strong> — Activity
              → Export → GPX
            </li>
            <li>
              <strong className="text-foreground">Komoot</strong> — Tour page →
              ↓ → GPX
            </li>
            <li>
              <strong className="text-foreground">Wahoo</strong> — Workout →
              Export → GPX
            </li>
            <li>
              <strong className="text-foreground">Apple Watch</strong> — via
              WorkOutDoors or HealthExport apps
            </li>
            <li>
              <strong className="text-foreground">Polar, Suunto, COROS</strong>{" "}
              — check the activity export menu in their web or mobile apps
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card id="format-fit" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge className="text-base">FIT</Badge>
            <span className="text-sm font-normal text-muted-foreground">
              Flexible &amp; Interoperable Data Transfer
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Binary format from Garmin devices. Contains the same GPS data as
            GPX.
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Garmin Connect</strong> —
              Activity → ⋯ → Export Original (gives a{" "}
              <InlineCode>.fit</InlineCode> file)
            </li>
            <li>
              <strong className="text-foreground">Cycling computers</strong> —
              Wahoo, Hammerhead, Bryton, and others save activities as FIT files
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            FIT files also carry <strong>laps</strong> — the splits your watch
            recorded, whether you pressed the lap button or it auto-lapped.
            Select an activity and you can switch the stats panel between the
            whole activity and any single lap, and share that lap on its own. A
            lap selector only appears when the file records at least two laps
            (and, as a sanity limit, at most 200 — a file with more than that is
            treated as having none), and only when a single activity is
            selected.
          </p>
          <p className="text-xs text-muted-foreground">
            If your app offers both GPX and FIT, either works for the fog map —
            but only FIT gives you laps. GPX has no lap data at all: the segment
            splits inside a GPX file are pause/resume boundaries, not laps.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">
              Activities imported before laps were supported won't show them.
            </strong>{" "}
            Simply re-importing the file will not help — activities are matched
            on their contents, so the re-import is recognised as a duplicate and
            skipped. To get laps for an old activity,{" "}
            <strong className="text-foreground">
              delete the activity first
            </strong>{" "}
            (select it, then the trash button in the stats panel) and import the
            FIT file again.
          </p>
        </CardContent>
      </Card>
    </>
  )
}
