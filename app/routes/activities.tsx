import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGrid } from "~/components/activities/ActivitiesGrid"
import { PageShell } from "~/components/PageShell"
import { mapStore } from "~/lib/mapStore"
import { loadActivities, saveActivities } from "~/lib/storage"
import {
  populateUniqueDistances,
  sortActivities,
  sortActivitiesNewestFirst,
} from "~/lib/statsAggregator"
import { isActivityType } from "~/lib/activityType"
import type { ParsedActivity } from "~/types/activities"
import type { Route } from "./+types/activities"

export async function clientLoader(): Promise<ParsedActivity[]> {
  if (mapStore.activities.length === 0) {
    mapStore.activities = sortActivities(await loadActivities())
    populateUniqueDistances(mapStore.activities)
  }
  return sortActivitiesNewestFirst(mapStore.activities)
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData()
  if (formData.get("intent") !== "update-activity-type") return null

  const activityId = formData.get("activityId")
  const activityType = formData.get("activityType")
  if (typeof activityId !== "string" || !isActivityType(activityType)) {
    return { ok: false as const }
  }

  const activity = mapStore.activities.find((item) => item.id === activityId)
  if (!activity) return { ok: false as const }

  activity.activityType = activityType
  await saveActivities([activity])
  return { ok: true as const, activityId, activityType }
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
