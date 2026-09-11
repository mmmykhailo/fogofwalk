import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGridWithSorting } from "~/components/activities/ActivitiesGridWithSorting"
import { PageShell } from "~/components/PageShell"
import {
  activityLibrary,
  initializeActivityLibrary,
  mapStore,
} from "~/lib/mapStore"
import { sortActivitiesNewestFirst } from "~/lib/statsAggregator"
import { isActivityType } from "~/lib/activityType"
import { pushActivityUpdate } from "~/lib/server/syncEngine"
import { createUuid } from "~/lib/uuid"
import type { ParsedActivity } from "~/types/activities"
import type { Route } from "./+types/activities"

export async function clientLoader(): Promise<ParsedActivity[]> {
  const activities = await initializeActivityLibrary()
  return sortActivitiesNewestFirst(activities)
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

  const updatedActivity = {
    ...activity,
    activityType,
  }
  await activityLibrary.dispatch({
    type: "applyRemote",
    operationId: createUuid(),
    changes: [{ type: "upsert", activity: updatedActivity }],
  })
  await pushActivityUpdate(updatedActivity)
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
        <ActivitiesGridWithSorting activities={activities} />
      )}
    </PageShell>
  )
}
