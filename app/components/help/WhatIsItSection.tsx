export function WhatIsItSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Fog of Walk turns your activity files into a living map of your world.
        The entire map starts covered in fog — and every route you've ever
        walked, run, or cycled gradually clears it away, revealing the areas
        you've actually explored.
      </p>
      <p>
        It's a way to see your city (or the world) through the lens of your own
        movement. After importing your activities you'll quickly spot the
        neighbourhoods you know well, the streets you've never set foot on, and
        the blank patches just waiting to be discovered.
      </p>
      <p>
        <strong className="text-foreground">Why people use it:</strong>
      </p>
      <ul className="ml-4 list-disc space-y-1">
        <li>
          Visualise how much of your city you've explored over months or years
        </li>
        <li>Set a goal to clear a whole district, borough, or country</li>
        <li>
          Find new routes by spotting the gaps in the fog near familiar areas
        </li>
        <li>
          Attach photos to your routes and build a personal map of memories
        </li>
      </ul>
      <p>
        Nothing to sign up for. Open the page, pick some files, and the map is
        yours — everything is computed and stored on your own device. If you
        don't have an activity file to hand, the first-run dialog has a{" "}
        <strong className="text-foreground">Try sample</strong> button that
        loads a demo run.
      </p>
    </div>
  )
}
