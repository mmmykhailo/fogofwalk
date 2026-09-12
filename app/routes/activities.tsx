import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivityLibrary } from "~/components/activities/ActivityLibrary"
import { PageShell } from "~/components/PageShell"
import {
  activityLibrary,
  initializeActivityLibrary,
  mapStore,
  setActivitySummaries,
} from "~/lib/mapStore"
import { activityToSummary, loadActivitySummaries } from "~/lib/storage"
import type { ActivitySummary } from "~/types/activitySummary"
import {
  parseActivitySettingsUpdate,
  type ActivitySettingsActionResult,
} from "~/lib/activitySettings"
import { canSync, initAuth } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"
import { requestSync } from "~/lib/server/syncEngine"
import { createActivityUploadOutboxItem } from "~/lib/server/sync/activityEffects"
import { createUuid } from "~/lib/uuid"
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

export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<ActivitySettingsActionResult | null> {
  const formData = await request.formData()
  if (formData.get("intent") !== "update-activity-settings") return null

  const update = parseActivitySettingsUpdate(formData)
  if (!update.ok) return update

  await initializeActivityLibrary()
  const activityById = new Map(
    activityLibrary
      .getSnapshot()
      .activities.map((activity) => [activity.id, activity])
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

  const resolved = activities.filter(
    (activity): activity is NonNullable<typeof activity> => activity != null
  )
  if (
    update.setting === "visibility" &&
    (!canSync() || resolved.some((activity) => !activity.contentHash))
  ) {
    return {
      ok: false as const,
      error: "Visibility can only be changed for synced activities.",
    }
  }

  const changed = resolved.filter((activity) =>
    update.setting === "visibility"
      ? (activity.isPublic ?? false) !== update.value
      : activity.activityType !== update.value
  )

  const changedActivities = changed.map((activity) => ({
    ...activity,
    ...(update.setting === "visibility"
      ? { isPublic: update.value }
      : { activityType: update.value }),
  }))
  const operationId = createUuid()
  const commit = await activityLibrary.dispatch(
    {
      type: "applyRemote",
      operationId,
      changes: changedActivities.map((activity) => ({
        type: "upsert" as const,
        activity,
      })),
    },
    {
      outbox: isServerEnabled
        ? (result) =>
            result.change.updated.flatMap((activity) => {
              const item = createActivityUploadOutboxItem(
                activity,
                operationId,
                result.snapshot.revision
              )
              return item ? [item] : []
            })
        : [],
    }
  )
  if (commit.change.updated.length > 0) requestSync("activity-settings-update")

  return {
    ok: true as const,
    updatedActivityIds: commit.change.updated.map((activity) => activity.id),
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
        <ActivityLibrary activities={activities} />
      )}
    </PageShell>
  )
}
