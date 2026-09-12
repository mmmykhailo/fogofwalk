import { useLoaderData } from "react-router"
import { EmptyActivitiesState } from "~/components/activities/EmptyActivitiesState"
import { ActivityLibrary } from "~/components/activities/ActivityLibrary"
import { PageShell } from "~/components/PageShell"
import {
  activityLibrary,
  mapStore,
  setActivitySummarySnapshot,
  useActivitySummarySnapshot,
} from "~/lib/mapStore"
import { activityToSummary } from "~/lib/storage"
import type { ActivitySummary } from "~/types/activitySummary"
import {
  parseActivitySettingsUpdate,
  type ActivityMetadataActionResult,
} from "~/lib/activitySettings"
import { canSync, initAuth } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"
import { requestSync } from "~/lib/server/syncEngine"
import { createActivityMetadataOutboxItems } from "~/lib/server/sync/activityEffects"
import { createUuid } from "~/lib/uuid"
import type { Route } from "./+types/activities"
import { markPerformance, measurePerformance } from "~/lib/performance"
import type { ShouldRevalidateFunction } from "react-router"
import { isActivitiesViewOnlyNavigation } from "~/lib/activitiesRoute"
import { isActivityMetadataActionResult } from "~/lib/homeRoute"

export async function clientLoader(): Promise<ActivitySummary[]> {
  markPerformance("activities:loader:start")
  void initAuth()
  let activities: ActivitySummary[]
  if (mapStore.activityHydration === "full") {
    activities = mapStore.activities.map(activityToSummary)
  } else {
    markPerformance("activities:idb-load:start")
    const summarySnapshot = await activityLibrary.initializeSummarySnapshot()
    markPerformance("activities:idb-load:end")
    measurePerformance(
      "activities:idb-load",
      "activities:idb-load:start",
      "activities:idb-load:end"
    )
    activities = [...summarySnapshot.summaries]
    setActivitySummarySnapshot(summarySnapshot)
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
  actionResult,
  defaultShouldRevalidate,
}) => {
  if (
    formMethod != null &&
    formMethod !== "GET" &&
    isActivityMetadataActionResult(actionResult)
  ) {
    return false
  }
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
}: Route.ClientActionArgs): Promise<ActivityMetadataActionResult | null> {
  const formData = await request.formData()
  if (formData.get("intent") !== "update-activity-settings") return null

  const submittedOperationId = formData.get("operationId")
  const operationId =
    typeof submittedOperationId === "string" &&
    submittedOperationId.length > 0 &&
    submittedOperationId.length <= 200
      ? submittedOperationId
      : createUuid()
  try {
    const update = parseActivitySettingsUpdate(formData)
    if (!update.ok) return { ok: false, operationId, error: update.error }

    const summarySnapshot = await activityLibrary.initializeSummarySnapshot()
    const activityById = new Map(
      summarySnapshot.summaries.map((activity) => [activity.id, activity])
    )
    const activities = update.activityIds.map((activityId) =>
      activityById.get(activityId)
    )
    if (activities.some((activity) => activity == null)) {
      return {
        ok: false,
        operationId,
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
        ok: false,
        operationId,
        error: "Visibility can only be changed for synced activities.",
      }
    }

    const patches = resolved.map((activity) =>
      update.setting === "visibility"
        ? { id: activity.id, isPublic: update.value }
        : { id: activity.id, activityType: update.value }
    )
    const commit = await activityLibrary.dispatchMetadata(
      {
        type: "updateMetadata",
        operationId,
        patches,
      },
      {
        metadataOutbox: isServerEnabled
          ? (result) => {
              const changedIds = new Set(
                result.updated.map((activity) => activity.id)
              )
              return createActivityMetadataOutboxItems(
                resolved,
                patches.filter((patch) => changedIds.has(patch.id)),
                operationId,
                result.revision
              )
            }
          : undefined,
      }
    )
    if (commit.updated.length > 0 && isServerEnabled) {
      requestSync("activity-settings-update")
    }

    return {
      ok: true,
      operationId,
      revision: commit.revision,
      coverageRevision: commit.coverageRevision,
      updated: commit.updated,
    }
  } catch (error) {
    return {
      ok: false,
      operationId,
      error:
        error instanceof Error
          ? error.message
          : "The activity setting could not be saved.",
    }
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "My activities — Fog of Walk" },
    { name: "description", content: "Your imported activities." },
  ]
}

export default function MyActivitiesPage() {
  const loadedActivities = useLoaderData<typeof clientLoader>()
  const liveSnapshot = useActivitySummarySnapshot()
  const activities = liveSnapshot.hydrated
    ? [...liveSnapshot.summaries]
    : loadedActivities

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
