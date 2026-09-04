import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGridWithSortingHeader } from "~/components/activities/ActivitiesGridWithSortingHeader"
import { PageShell } from "~/components/PageShell"
import { mapStore } from "~/lib/mapStore"
import {
  areUniqueDistancesCurrent,
  loadActivities,
  loadUniqueDistanceState,
  saveActivities,
  saveUniqueDistances,
} from "~/lib/storage"
import {
  populateUniqueDistances,
  sortActivities,
  sortActivitiesNewestFirst,
} from "~/lib/statsAggregator"
import { parseActivitySettingsUpdate } from "~/lib/activitySettings"
import { canSync, initAuth } from "~/lib/server/authStore"
import { pushActivityUpdate } from "~/lib/server/syncEngine"
import type { ParsedActivity } from "~/types/activities"
import type { Route } from "./+types/activities"

export async function clientLoader(): Promise<ParsedActivity[]> {
  void initAuth()
  if (mapStore.activities.length === 0) {
    const [activities, uniqueDistanceState] = await Promise.all([
      loadActivities(),
      loadUniqueDistanceState(),
    ])
    mapStore.activities = sortActivities(activities)
    if (!areUniqueDistancesCurrent(mapStore.activities, uniqueDistanceState)) {
      await populateUniqueDistances(mapStore.activities)
      await saveUniqueDistances(mapStore.activities)
    }
  }
  return sortActivitiesNewestFirst(mapStore.activities)
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData()
  if (formData.get("intent") !== "update-activity-settings") return null

  const update = parseActivitySettingsUpdate(formData)
  if (!update.ok) return update

  const activities = update.activityIds.map((activityId) =>
    mapStore.activities.find((activity) => activity.id === activityId)
  )
  if (activities.some((activity) => activity == null)) {
    return {
      ok: false as const,
      error: "One or more activities no longer exist.",
    }
  }

  const resolved = activities as ParsedActivity[]
  if (
    update.setting === "publicity" &&
    (!canSync() || resolved.some((activity) => !activity.contentHash))
  ) {
    return {
      ok: false as const,
      error: "Publicity can only be changed for synced activities.",
    }
  }

  const changed = resolved.filter((activity) =>
    update.setting === "publicity"
      ? (activity.isPublic ?? false) !== update.value
      : activity.activityType !== update.value
  )

  for (const activity of changed) {
    if (update.setting === "publicity") activity.isPublic = update.value
    else activity.activityType = update.value
  }

  await saveActivities(changed)
  await Promise.all(changed.map((activity) => pushActivityUpdate(activity)))

  return {
    ok: true as const,
    updatedActivityIds: changed.map((activity) => activity.id),
    setting: update.setting,
    value: update.value,
  }
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
        <ActivitiesGridWithSortingHeader activities={activities} />
      )}
    </PageShell>
  )
}
