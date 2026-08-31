import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import type { Route } from "./+types/stats"
import {
  areUniqueDistancesCurrent,
  loadActivities,
  loadUniqueDistanceState,
  saveUniqueDistances,
} from "~/lib/storage"
import { mapStore } from "~/lib/mapStore"
import {
  sortActivities,
  computeLifetimeTotals,
  computeWeeklyBars,
  computeStreaks,
  computePersonalRecords,
  computeUniqueDistance,
  populateUniqueDistances,
  type LifetimeTotals,
  type WeeklyBar,
  type Streaks,
  type PersonalRecords,
} from "~/lib/statsAggregator"
import { StatCards } from "~/components/stats/StatCards"
import { WeeklyChart } from "~/components/stats/WeeklyChart"
import { StreaksCard } from "~/components/stats/StreaksCard"
import { PersonalRecordsCard } from "~/components/stats/PersonalRecordsCard"
import { TransitionLink } from "~/components/TransitionLink"
import { Grid } from "~/components/Grid"

// ─── Loader ───────────────────────────────────────────────────────────────────

interface StatsLoaderData {
  totals: LifetimeTotals
  weekly: WeeklyBar[]
  streaks: Streaks
  records: PersonalRecords
  uniqueDistanceKm: number
}

export async function clientLoader(): Promise<StatsLoaderData> {
  // Prefer in-memory activities (always current — updated before the IDB write in
  // clientAction). Fall back to IDB only when navigating directly to /stats on
  // a fresh page load before the home clientLoader has run.
  let raw = mapStore.activities
  if (raw.length === 0) {
    const [storedActivities, uniqueDistanceState] = await Promise.all([
      loadActivities(),
      loadUniqueDistanceState(),
    ])
    raw = storedActivities
    const sorted = sortActivities(raw)
    if (!areUniqueDistancesCurrent(sorted, uniqueDistanceState)) {
      await populateUniqueDistances(sorted)
      await saveUniqueDistances(sorted)
    }
    mapStore.activities = sorted
  }
  const activities = sortActivities(raw)
  const now = Date.now()
  return {
    totals: computeLifetimeTotals(activities),
    weekly: computeWeeklyBars(activities),
    streaks: computeStreaks(activities, now),
    records: computePersonalRecords(activities),
    uniqueDistanceKm: computeUniqueDistance(activities),
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stats — Fog of Walk" },
    { name: "description", content: "Your lifetime activity statistics." },
  ]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { totals, weekly, streaks, records, uniqueDistanceKm } =
    useLoaderData<typeof clientLoader>()
  const isEmpty = totals.totalActivities === 0

  return (
    <PageShell title="Your Stats">
      {isEmpty ? (
        /* ── Empty state ── */
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <FootprintsIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">
            Import some activities to see your stats.
          </p>
          <TransitionLink
            to="/"
            className="mt-1 text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </TransitionLink>
        </div>
      ) : (
        <div className="space-y-4">
          <StatCards totals={totals} uniqueDistanceKm={uniqueDistanceKm} />
          <WeeklyChart weekly={weekly} />
          <Grid columns={{ base: 1, sm: 2 }}>
            <StreaksCard streaks={streaks} />
            <PersonalRecordsCard records={records} />
          </Grid>
        </div>
      )}
    </PageShell>
  )
}
