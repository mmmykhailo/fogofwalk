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
        </CardContent>
      </Card>
    </>
  )
}
