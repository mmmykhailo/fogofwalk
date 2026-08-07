import type { Route } from "./+types/help"
import { PageShell } from "~/components/PageShell"
import { PageSection } from "~/components/PageSection"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AppLink } from "~/components/AppLink"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "How it works — Fog of Walk" },
    {
      name: "description",
      content:
        "Learn how to use Fog of Walk: supported file formats (GPX, FIT), how to add photos, workflow tips, and troubleshooting.",
    },
  ]
}

export default function HelpPage() {
  return (
    <PageShell title="How Fog of Walk works">
      {/* What is Fog of Walk */}
      <PageSection title="What is Fog of Walk?">
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Fog of Walk turns your activity files into a living map of your
            world. The entire map starts covered in fog — and every route you've
            ever walked, run, or cycled gradually clears it away, revealing the
            areas you've actually explored.
          </p>
          <p>
            It's a way to see your city (or the world) through the lens of your
            own movement. After importing your activities you'll quickly spot
            the neighbourhoods you know well, the streets you've never set foot
            on, and the blank patches just waiting to be discovered.
          </p>
          <p>
            <strong className="text-foreground">Why people use it:</strong>
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Visualise how much of your city you've explored over months or
              years
            </li>
            <li>Set a goal to clear a whole district, borough, or country</li>
            <li>
              Find new routes by spotting the gaps in the fog near familiar
              areas
            </li>
            <li>
              Attach photos to your routes and build a personal map of memories
            </li>
          </ul>
        </div>
      </PageSection>

      <hr className="mb-10 border-border" />

      {/* Workflow */}
      <PageSection title="Workflow">
        <ol className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              1
            </Badge>
            <span>
              <strong className="text-foreground">Import activity files</strong>{" "}
              — upload{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.gpx</code>{" "}
              or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.fit</code>{" "}
              files from your device. Multiple files are supported; you can add
              more at any time.
            </span>
          </li>
          <li className="flex gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              2
            </Badge>
            <span>
              <strong className="text-foreground">
                Fog clears along your routes
              </strong>{" "}
              — a 100 m corridor is revealed around each track. Enable{" "}
              <em>Fill loops</em> to also clear the interior of closed loops
              (e.g. a park circuit).
            </span>
          </li>
          <li className="flex gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              3
            </Badge>
            <span>
              <strong className="text-foreground">Add photos (optional)</strong>{" "}
              — upload JPEG or HEIC photos. They appear as markers on the map at
              the location where you were when the photo was taken, matched by
              timestamp.
            </span>
          </li>
          <li className="flex gap-3">
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              4
            </Badge>
            <span>
              <strong className="text-foreground">
                Everything stays in your browser
              </strong>{" "}
              — no account, no server. Your data is stored locally in your
              browser and never uploaded anywhere.
            </span>
          </li>
        </ol>
      </PageSection>

      <hr className="mb-10 border-border" />

      {/* Supported file formats */}
      <PageSection title="Supported file formats">
        <Card className="mb-4">
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
                <strong className="text-foreground">AllTrails</strong> —
                Activity → Export → GPX
              </li>
              <li>
                <strong className="text-foreground">Komoot</strong> — Tour page
                → ↓ → GPX
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
                <strong className="text-foreground">
                  Polar, Suunto, COROS
                </strong>{" "}
                — check the activity export menu in their web or mobile apps
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
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
                <code className="text-xs">.fit</code> file)
              </li>
              <li>
                <strong className="text-foreground">Cycling computers</strong> —
                Wahoo, Hammerhead, Bryton, and others save activities as FIT
                files
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              FIT files also carry <strong>laps</strong> — the splits your watch
              recorded, whether you pressed the lap button or it auto-lapped.
              Select a track and you can switch the stats panel between the
              whole activity and any single lap, and share that lap on its own.
              GPX has no lap data, and tracks imported before this was added
              won&rsquo;t show laps until you re-import them.
            </p>
            <p className="text-xs text-muted-foreground">
              If your app offers both GPX and FIT, either works for the fog map
              — but only FIT gives you laps.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      <hr className="mb-10 border-border" />

      {/* Adding photos */}
      <PageSection title="Adding photos">
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Photos don't need GPS coordinates — location is determined by
            matching the photo's timestamp to the nearest point in your tracks.
          </p>
          <p>
            <strong className="text-foreground">Requirements:</strong>
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              JPEG (<code className="rounded bg-muted px-1 text-xs">.jpg</code>{" "}
              / <code className="rounded bg-muted px-1 text-xs">.jpeg</code>) or
              HEIC format
            </li>
            <li>
              An embedded EXIF timestamp (<em>DateTimeOriginal</em>) — present
              in photos taken with a phone or camera, but often missing in
              screenshots or edited photos
            </li>
            <li>Activity tracks must be loaded first</li>
            <li>
              Photo must be taken within 5 minutes of a recorded track point
            </li>
          </ul>
          <Alert>
            <AlertTitle>Photos not showing up?</AlertTitle>
            <AlertDescription>
              The most common reasons: no tracks loaded yet, photo has no
              timestamp (screenshot or edited photo), or the photo was taken
              more than 5 minutes before or after any tracked activity.
            </AlertDescription>
          </Alert>
        </div>
      </PageSection>

      <hr className="mb-10 border-border" />

      {/* Troubleshooting */}
      <PageSection title="Troubleshooting">
        <div className="space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="mb-1 font-medium text-foreground">
              File picker doesn't open / nothing happens after selecting files
            </p>
            <p>
              Some in-app browsers (Telegram, Instagram, Facebook, etc.)
              restrict file access. Open this page in your device's native
              browser — <strong className="text-foreground">Safari</strong> on
              iOS or <strong className="text-foreground">Chrome</strong> on
              Android — for full functionality.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-foreground">
              Track looks wrong or incomplete
            </p>
            <p>
              Some apps trim GPS data when exporting. Try exporting as a
              different format (e.g. FIT instead of GPX from Garmin Connect) or
              use the original file from your device if available.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-foreground">
              My data disappeared after closing the tab
            </p>
            <p>
              Data is stored in your browser's IndexedDB. Clearing browser data
              / site data will erase it. Private/incognito mode may not persist
              data between sessions.
            </p>
          </div>
        </div>
      </PageSection>

      <div className="pt-4 text-center">
        <AppLink to="/" variant="nav">
          Back to map
        </AppLink>
      </div>
    </PageShell>
  )
}
