import { useEffect } from "react"
import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGridWithSorting } from "~/components/activities/ActivitiesGridWithSorting"
import { PageShell } from "~/components/PageShell"
import { mapStore } from "~/lib/mapStore"
import { loadActivities, saveActivities } from "~/lib/storage"
import { sortActivities } from "~/lib/statsAggregator"
import { parseActivitySettingsUpdate } from "~/lib/activitySettings"
import { canSync, initAuth } from "~/lib/server/authStore"
import { pushActivityUpdate } from "~/lib/server/syncEngine"
import type { ParsedActivity } from "~/types/activities"
import type { Route } from "./+types/activities"
import { markPerformance, measurePerformance } from "~/lib/performance"
import { ensureUniqueDistancesCurrent } from "~/lib/uniqueDistanceRepair"
import type { ShouldRevalidateFunction } from "react-router"
import { isActivitiesSortOnlyNavigation } from "~/lib/activitiesRoute"

export async function clientLoader(): Promise<ParsedActivity[]> {
  markPerformance("activities:loader:start")
  void initAuth()
  if (mapStore.activities.length === 0) {
    markPerformance("activities:idb-load:start")
    const activities = await loadActivities()
    markPerformance("activities:idb-load:end")
    measurePerformance(
      "activities:idb-load",
      "activities:idb-load:start",
      "activities:idb-load:end"
    )
    mapStore.activities = sortActivities(activities)
  }
  markPerformance("activities:loader:end")
  measurePerformance(
    "activities:loader",
    "activities:loader:start",
    "activities:loader:end"
  )
  return mapStore.activities
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (
    (formMethod == null || formMethod === "GET") &&
    isActivitiesSortOnlyNavigation(currentUrl, nextUrl)
  ) {
    return false
  }
  return defaultShouldRevalidate
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData()
  if (formData.get("intent") !== "update-activity-settings") return null

  const update = parseActivitySettingsUpdate(formData)
  if (!update.ok) return update

  const activityById = new Map(
    mapStore.activities.map((activity) => [activity.id, activity])
  )
  const activities = update.activityIds.map((activityId) =>
    activityById.get(activityId)
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

  useEffect(() => {
    markPerformance("activities:unique-distance:queued")
    void ensureUniqueDistancesCurrent(activities).catch((error) => {
      console.warn("[activities] unique-distance repair failed:", error)
    })
  }, [activities])

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
