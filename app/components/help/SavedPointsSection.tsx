import { AppLink } from "~/components/AppLink"

export function SavedPointsSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Save a place by right-clicking the map on desktop or pressing and
        holding it on a touch screen, including over a recorded route. Existing
        map markers keep their own interaction, so tap an owned marker to edit
        or delete it. Give the point a name, an optional description, a colour,
        and exact coordinates.
      </p>
      <p>
        The <AppLink to="/saved-points">My saved points</AppLink> page lists all
        saved places and links each one back to its map position. The map menu's
        <strong className="text-foreground"> Show saved points</strong> switch
        only changes marker visibility; it does not delete anything.
      </p>
      <p>
        Saved points work locally without an account. When sync is available and
        you sign in, they sync alongside activities. A point marked public can
        appear on your public profile and its map link can be opened without
        signing in; private points remain visible only to you.
      </p>
    </div>
  )
}
