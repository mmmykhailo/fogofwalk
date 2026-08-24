const TOGGLES = [
  ["Show activities", "draw the route lines on top of the cleared fog"],
  ["Show fog", "turn the fog off entirely to see the bare map underneath"],
  [
    "Show photos",
    "hide the photo markers without deleting anything (appears once you have photos)",
  ],
  [
    "Fill loops",
    "switch from clearing just a corridor to also clearing the inside of closed loops",
  ],
]

export function MapControlsSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        The round button in the corner of the map opens the menu, which holds
        everything: adding files and photos, the display switches, and links to
        statistics and this page.
      </p>
      <ul className="ml-4 list-disc space-y-1">
        {TOGGLES.map(([name, what]) => (
          <li key={name}>
            <strong className="text-foreground">{name}</strong> — {what}
          </li>
        ))}
        <li>
          <strong className="text-foreground">Map style</strong> — switch
          between the standard map and a satellite view with 3D terrain relief
        </li>
      </ul>
      <p>
        Switching <em>Fill loops</em> reprocesses every activity, so it takes a
        moment on a large library. Your map position and zoom are remembered
        between visits, and the compass in the corner resets the view to north
        when you've rotated or tilted the map.
      </p>
    </div>
  )
}
