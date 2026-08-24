import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
import { PageShell } from "~/components/PageShell"
import { mapStore } from "~/lib/mapStore"
import { loadActivities } from "~/lib/storage"
import { sortActivities } from "~/lib/statsAggregator"
import type { ParsedActivity } from "~/types/activities"
import type { Route } from "./+types/activities"

export async function clientLoader(): Promise<ParsedActivity[]> {
  const activities =
    mapStore.activities.length > 0
      ? mapStore.activities
      : await loadActivities()
  return sortActivities(activities)
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "My activities — Fog of Walk" },
    { name: "description", content: "Your imported activities." },
  ]
}

export default function MyActivitiesPage() {
  const activities = useLoaderData<typeof clientLoader>()

  return (
    <PageShell title="My activities">
      {activities.length === 0 ? (
        <EmptyActivitiesState />
      ) : (
        <ActivitiesGrid activities={activities} />
      )}
    </PageShell>
  )
}
