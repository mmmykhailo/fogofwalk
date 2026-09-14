import { AppLink } from "~/components/AppLink"

export function ManagingActivitiesSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Open <AppLink to="/activities">My activities</AppLink> from the map menu
        to browse the complete library without loading every route into the
        page. Activities are shown 48 at a time and can be sorted by date,
        distance, moving speed, duration, or elevation gain. Selecting a card's
        main area opens that activity on the map.
      </p>
      <p>
        Use the checkbox on one or more cards to edit them together. Activity
        type can be set to walking, running, cycling, kayaking, swimming, or
        other; this is useful when an imported file did not include a type.
      </p>
      <p>
        Signed-in users with sync access can also make activities public or
        private. Visibility controls require sync access and a valid content
        identity. These metadata edits do not rebuild fog because they do not
        change route geometry.
      </p>
    </div>
  )
}
