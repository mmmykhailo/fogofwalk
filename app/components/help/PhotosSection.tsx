import { PageSection } from "~/components/PageSection"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { InlineCode } from "~/components/help/InlineCode"

export function PhotosSection() {
  return (
    <PageSection title="Adding photos">
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Photos don't need GPS coordinates — location is determined by matching
          the photo's timestamp to the nearest point in your tracks. Photos are
          only offered once you have at least one track loaded.
        </p>
        <p>
          <strong className="text-foreground">Requirements:</strong>
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Any image file with an embedded EXIF timestamp — in practice a JPEG
            (<InlineCode>.jpg</InlineCode> / <InlineCode>.jpeg</InlineCode>) or
            HEIC straight from a phone or camera. Screenshots and heavily edited
            or re-exported images usually have had the timestamp stripped
          </li>
          <li>
            The timestamp comes from <em>DateTimeOriginal</em>, falling back to{" "}
            <em>DateTime</em>
          </li>
          <li>Activity tracks must be loaded first</li>
          <li>
            The photo must be taken within 5 minutes of a recorded track point
          </li>
          <li>
            The track itself must carry{" "}
            <strong className="text-foreground">per-point timestamps</strong>.
            Recorded activities do; a route you <em>planned</em> in Komoot,
            AllTrails or similar does not, so no photo can ever be matched to it
          </li>
        </ul>
        <p>
          Matched photos appear as circular markers. Where several sit close
          together they collapse into one cluster marker with a count badge —
          clusters are recalculated as you zoom, so zooming in splits them
          apart. Tap a marker or cluster to open the photo viewer, which you can
          drag around the screen.
        </p>
        <Alert>
          <AlertTitle>Photos not showing up?</AlertTitle>
          <AlertDescription>
            The most common reasons: no tracks loaded yet, the photo has no
            timestamp (a screenshot or an edited copy), the photo was taken more
            than 5 minutes before or after any tracked activity, or the track it
            belongs to is a planned route with no per-point times.
          </AlertDescription>
        </Alert>
      </div>
    </PageSection>
  )
}
