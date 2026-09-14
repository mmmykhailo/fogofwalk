export function InstallSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Fog of Walk can be installed to your home screen or desktop — on iOS via
        Safari's <em>Share → Add to Home Screen</em>, on Android and desktop
        Chrome via the install prompt or the browser menu. It then runs in its
        own window, without browser chrome.
      </p>
      <p>
        <strong className="text-foreground">
          The best reason to install it: sharing files directly.
        </strong>{" "}
        Once installed, Fog of Walk appears in your system share sheet, so you
        can export a GPX or FIT from Strava, Garmin Connect or a file manager
        and send it straight here — no downloading and re-picking the file. The
        activity is imported as soon as the app opens.
      </p>
      <p>
        The app shell and standard map resources you have already used are
        cached, with map resources retained for about a month. Previously
        visited standard-map areas can therefore keep working without a
        connection. Importing files, browsing local data, and viewing your stats
        do not need the sync server.
      </p>
    </div>
  )
}
