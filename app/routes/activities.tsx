import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivitiesGridWithSorting } from "~/components/activities/ActivitiesGridWithSorting"
import { PageShell } from "~/components/PageShell"
import {
  mapStore,
  setActivitySummaries,
  updateActivitySummaries,
} from "~/lib/mapStore"
import {
  activityToSummary,
  loadActivitySummaries,
  updateActivitySettings,
} from "~/lib/storage"
import type { ActivitySummary } from "~/types/activitySummary"
import { parseActivitySettingsUpdate } from "~/lib/activitySettings"
import { canSync, initAuth } from "~/lib/server/authStore"
import { queueActivityMetadataUpdates } from "~/lib/server/syncEngine"
import type { Route } from "./+types/activities"
import { markPerformance, measurePerformance } from "~/lib/performance"
import type { ShouldRevalidateFunction } from "react-router"
import { isActivitiesViewOnlyNavigation } from "~/lib/activitiesRoute"

export async function clientLoader(): Promise<ActivitySummary[]> {
  markPerformance("activities:loader:start")
  void initAuth()
  let activities: ActivitySummary[]
  if (mapStore.activityHydration === "full") {
    activities = mapStore.activities.map(activityToSummary)
  } else if (mapStore.activityHydration === "summaries") {
    activities = mapStore.activitySummaries
  } else {
    markPerformance("activities:idb-load:start")
    activities = await loadActivitySummaries()
    markPerformance("activities:idb-load:end")
    measurePerformance(
      "activities:idb-load",
      "activities:idb-load:start",
      "activities:idb-load:end"
    )
    setActivitySummaries(activities)
  }
  markPerformance("activities:loader:end")
  measurePerformance(
    "activities:loader",
    "activities:loader:start",
    "activities:loader:end"
  )
  return activities
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (
    (formMethod == null || formMethod === "GET") &&
    isActivitiesViewOnlyNavigation(currentUrl, nextUrl)
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

  const sourceActivities: ActivitySummary[] =
    mapStore.activities.length > 0
      ? mapStore.activities.map(activityToSummary)
      : mapStore.activityHydration === "summaries"
        ? mapStore.activitySummaries
        : await loadActivitySummaries()
  const activityById = new Map(
    sourceActivities.map((activity) => [activity.id, activity])
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

  const resolved = activities as ActivitySummary[]
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

  const changedSummaries = changed.map((activity) => ({
    ...activity,
    ...(update.setting === "publicity"
      ? { isPublic: update.value }
      : { activityType: update.value }),
  }))
  const saved = await updateActivitySettings(
    changedSummaries.map((activity) => ({
      id: activity.id,
      ...(update.setting === "publicity"
        ? { isPublic: update.value }
        : { activityType: update.value }),
    }))
  )
  if (!saved) {
    return {
      ok: false as const,
      error: "Activity settings could not be saved.",
    }
  }

  const fullById =
    mapStore.activities.length > 0
      ? new Map(mapStore.activities.map((activity) => [activity.id, activity]))
      : null
  if (fullById) {
    for (const summary of changedSummaries) {
      const activity = fullById.get(summary.id)
      if (!activity) continue
      if (update.setting === "publicity") activity.isPublic = update.value
      else activity.activityType = update.value
    }
  } else {
    updateActivitySummaries(changedSummaries)
  }

  await queueActivityMetadataUpdates(
    changedSummaries.flatMap((summary) => {
      if (!summary.contentHash) return []
      return [
        {
          contentHash: summary.contentHash,
          ...(update.setting === "publicity"
            ? { isPublic: update.value }
            : { activityType: update.value }),
        },
      ]
    })
  )

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
        <ActivitiesGridWithSorting activities={activities} />
      )}
    </PageShell>
  )
}
