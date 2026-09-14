export function PublicProfileSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        When the optional server is configured, a signed-in account with a
        handle has a{" "}
        <strong className="text-foreground">My public profile</strong> link in
        the map menu. The profile shows statistics, recent activity,
        achievements, public activity cards, and public saved points derived
        only from items you have marked public.
      </p>
      <p>
        Activity visibility is managed from My activities or an activity's stats
        panel. Saved-point visibility is part of its edit form. New activities
        and saved points are private unless you choose otherwise, and photos are
        never published. As the owner, you can also hide an activity directly
        from its profile card.
      </p>
    </div>
  )
}
