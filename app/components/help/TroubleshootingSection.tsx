const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "File picker doesn't open / nothing happens after selecting files",
    a: (
      <>
        Some in-app browsers (Telegram, Instagram, Facebook, etc.) restrict file
        access. Open this page in your device's native browser —{" "}
        <strong className="text-foreground">Safari</strong> on iOS or{" "}
        <strong className="text-foreground">Chrome</strong> on Android — for
        full functionality.
      </>
    ),
  },
  {
    q: "I re-imported a file and nothing happened",
    a: (
      <>
        Activities are matched on their <em>contents</em>, not their filename,
        so importing the same activity twice — even renamed, even exported again
        from a different app — is recognised as a duplicate and skipped. That is
        what keeps your totals honest when you import a folder twice. If you
        actually need to replace a track (to pick up laps, for instance), delete
        it first, then import the file.
      </>
    ),
  },
  {
    q: "Track looks wrong or incomplete",
    a: (
      <>
        Some apps trim GPS data when exporting. Try exporting as a different
        format (e.g. FIT instead of GPX from Garmin Connect) or use the original
        file from your device if available. An activity with fewer than two
        valid GPS points clears no fog at all, which is why an indoor or
        treadmill session shows up as nothing.
      </>
    ),
  },
  {
    q: "My data disappeared after closing the tab",
    a: (
      <>
        Data is stored in your browser's storage for this site. Clearing browser
        data / site data will erase it, and private or incognito windows usually
        discard it when you close them. If you want a copy that survives a
        cleared browser, that is what the optional sync server is for.
      </>
    ),
  },
  {
    q: "Some photos vanished after a reload",
    a: (
      <>
        Photos are much larger than tracks and your browser caps how much a site
        may store. When that cap is hit the remaining photos in a batch are
        still shown for the rest of the session but are not saved, so they are
        gone after a reload. Importing fewer photos at a time, or clearing
        space, helps.
      </>
    ),
  },
  {
    q: "Fill loops didn't fill my loop",
    a: (
      <>
        A loop has to actually close for its interior to be cleared. An
        out-and-back, or a lap that stops a few hundred metres short of where it
        started, stays a corridor. Several separate activities that together
        form a closed circuit <em>are</em> detected, so a loop pieced out of two
        rides will fill.
      </>
    ),
  },
]

export function TroubleshootingSection() {
  return (
    <div className="space-y-4 text-sm text-muted-foreground">
      {ITEMS.map(({ q, a }) => (
        <div key={q}>
          <p className="mb-1 font-medium text-foreground">{q}</p>
          <p className="leading-relaxed">{a}</p>
        </div>
      ))}
    </div>
  )
}
