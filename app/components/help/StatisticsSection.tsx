import { AppLink } from "~/components/AppLink"

export function StatisticsSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        The <AppLink to="/stats">statistics page</AppLink> (menu →{" "}
        <strong className="text-foreground">Statistics</strong>) looks at your
        whole library rather than a single activity:
      </p>
      <ul className="ml-4 list-disc space-y-1">
        <li>
          Lifetime totals — distance, moving time, elevation gain, number of
          activities, active days, and a set of averages
        </li>
        <li>
          <strong className="text-foreground">Unique distance</strong> — how far
          you've travelled counting each stretch of ground only once, no matter
          how many times you've run it. Your total distance grows every time you
          repeat a loop; this only grows when you go somewhere new
        </li>
        <li>A weekly bar chart of distance, from your first activity to now</li>
        <li>
          A twelve-week activity grid with your current and longest streaks
        </li>
        <li>
          Personal records — your longest, hilliest and fastest single
          activities. Each links straight back to that track on the map
        </li>
      </ul>
      <p>
        Everything here is recomputed from the tracks on this device each time
        you open the page, so it reflects exactly what you have imported.
      </p>
    </div>
  )
}
