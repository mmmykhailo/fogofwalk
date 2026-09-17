import { TRAIL_MIN_RENDER_ZOOM } from "~/constants/trails"

const TOGGLES = [
  ["Show activities", "draw the route lines on top of the cleared fog"],
  [
    "Show trails",
    "show marked hiking and cycling routes derived from OpenStreetMap relations when the archive is available",
  ],
  ["Show fog", "turn the fog off entirely to see the bare map underneath"],
  [
    "Show photos",
    "hide the photo markers without deleting anything (appears once you have photos)",
  ],
  [
    "Show saved points",
    "hide saved-point markers without deleting anything (appears once you have saved points)",
  ],
  ["Show my location", "show or hide your device's current location marker"],
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
        adding files and photos, display switches, your activity and saved-point
        libraries, statistics, account options, and this page.
      </p>
      <ul className="ml-4 list-disc space-y-1">
        {TOGGLES.map(([name, what]) => (
          <li key={name}>
            <strong className="text-foreground">{name}</strong> — {what}
          </li>
        ))}
        <li>
          <strong className="text-foreground">Map style</strong> — switch
          between the standard map and satellite imagery with 3D terrain relief
        </li>
      </ul>
      <p>
        Switching <em>Fill loops</em> reprocesses every activity, so it takes a
        moment on a large library. Your map position and zoom are remembered
        between visits, and the compass in the corner resets the view to north
        when you've rotated or tilted the map. Use the adjacent buttons to zoom
        in or out.
      </p>
      <p>
        Trails appear from zoom {TRAIL_MIN_RENDER_ZOOM} onward when a periodic
        OpenStreetMap snapshot archive is configured. Hiking routes use their
        recognized OSM relation color, with a neutral purple fallback; shared
        routes can show several centered color lines. Cycling routes use a
        dashed pink line. The overlay is a display aid only: route coverage,
        geometry, access, and conditions may be incomplete or out of date, so do
        not use it as a navigation or safety-critical source.
      </p>
    </div>
  )
}
