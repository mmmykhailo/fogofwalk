export function ActivityStatsSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Tap any activity on the map to select it. The rest of your activities
        dim, and a stats panel opens — a drawer from the bottom on a phone, a
        panel you can drag around on a desktop.
      </p>
      <p>
        <strong className="text-foreground">For one activity</strong> you get
        distance, elapsed and moving time, elevation gain and loss, average pace
        and speed, and an elevation profile chart. FIT activities also get a lap
        dropdown, which narrows every number and the highlighted line on the map
        to a single lap.
      </p>
      <p>
        <strong className="text-foreground">
          For several activities at once
        </strong>{" "}
        — tap a second activity and you'll be asked whether to{" "}
        <em>Add to stats</em> (combine the two), <em>Replace</em> (switch the
        selection), or <em>Cancel</em>. With a multi-selection the panel lists
        every chosen activity and totals them, which is the quickest way to add
        up a weekend, a trip, or a training block.
      </p>
      <p>
        Two notes on the numbers.{" "}
        <strong className="text-foreground">Moving time</strong> excludes
        stopped segments, so it is shorter than elapsed time whenever you paused
        at lights or for a break — and average pace is calculated from it, while
        average speed uses elapsed time. Per-lap{" "}
        <strong className="text-foreground">elevation gain</strong> will not
        quite add up to the whole activity's figure: gain is measured with a
        smoothing filter that restarts at each lap boundary, which is the price
        of not counting GPS noise as climbing.
      </p>
      <p>
        To remove an activity, select it and use the trash button in the panel.
        If you're signed in for sync, the confirmation offers to delete the
        server copy too — see <em>Removing things</em> below.
      </p>
    </div>
  )
}
