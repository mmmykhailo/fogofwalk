import { PageSection } from "~/components/PageSection"

export function InstallSection() {
  return (
    <PageSection title="Install it as an app">
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Fog of Walk can be installed to your home screen or desktop — on iOS
          via Safari's <em>Share → Add to Home Screen</em>, on Android and
          desktop Chrome via the install prompt or the browser menu. It then
          runs in its own window, without browser chrome.
        </p>
        <p>
          <strong className="text-foreground">
            The best reason to install it: sharing files directly.
          </strong>{" "}
          Once installed, Fog of Walk appears in your system share sheet, so you
          can export a GPX or FIT from Strava, Garmin Connect or a file manager
          and send it straight here — no downloading and re-picking the file.
          The activity is imported as soon as the app opens.
        </p>
        <p>
          Map tiles you have already looked at are cached for about a month, and
          the app itself is cached too, so a previously visited area keeps
          working with no connection at all. Importing files and viewing your
          stats never needed the network in the first place.
        </p>
      </div>
    </PageSection>
  )
}
