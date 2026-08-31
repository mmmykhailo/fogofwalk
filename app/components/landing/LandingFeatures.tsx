import {
  ChartBarIcon,
  CloudSlashIcon,
  ImageIcon,
  MapTrifoldIcon,
} from "@phosphor-icons/react"
import { Grid } from "~/components/Grid"
import { FeatureCard } from "~/components/landing/FeatureCard"

export function LandingFeatures() {
  return (
    <section id="features" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          More than a map
        </p>
        <div className="mt-4 flex max-w-2xl flex-col gap-3">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            A reason to take the long way home.
          </h2>
          <p className="text-sm leading-7 text-muted-foreground sm:text-base">
            See the world through your own movement, from well-worn local
            streets to places you have yet to discover.
          </p>
        </div>
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} className="mt-10">
          <FeatureCard icon={MapTrifoldIcon} title="A map that remembers">
            Every imported route reveals a corridor around where you have been.
            Close a loop to clear the space inside it too.
          </FeatureCard>
          <FeatureCard icon={ChartBarIcon} title="Progress in perspective">
            See lifetime totals, weekly activity, streaks, personal records, and
            the unique distance you have covered.
          </FeatureCard>
          <FeatureCard icon={ImageIcon} title="Routes with memories">
            Add photos from your activities. They are matched by timestamp and
            placed where the moment happened.
          </FeatureCard>
          <FeatureCard icon={CloudSlashIcon} title="Private by default">
            Your files, photos, and fog stay in your browser. Optional sync is
            there only when you want it.
          </FeatureCard>
        </Grid>
      </div>
    </section>
  )
}
