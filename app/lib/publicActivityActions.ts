import { applyActivityMetadata, mapStore } from "~/lib/mapStore"
import { canSync, getAuthState, initAuth } from "~/lib/server/authStore"
import { friendlyMessage } from "~/lib/server/apiClient"
import { updateActivityVisibility } from "~/lib/server/activityVisibility"
import {
  activityToSummary,
  loadActivitySummaries,
  updateActivityMetadata,
} from "~/lib/storage"

export type PublicActivityActionResult =
  | { ok: true; intent: "hide-activity"; contentHash: string }
  | { ok: false; intent: "hide-activity"; error: string }

const CONTENT_HASH_RE = /^[a-f0-9]{64}$/

function failedHide(error: string): PublicActivityActionResult {
  return { ok: false, intent: "hide-activity", error }
}

async function reconcileLocalVisibility(contentHash: string): Promise<void> {
  const summaries =
    mapStore.activityHydration === "full"
      ? mapStore.activities.map(activityToSummary)
      : mapStore.activityHydration === "summaries"
        ? mapStore.activitySummaries
        : await loadActivitySummaries()
  const summary = summaries.find(
    (activity) => activity.contentHash === contentHash
  )
  if (!summary) return

  const updated = { ...summary, isPublic: false }
  if (!(await updateActivityMetadata([{ id: updated.id, isPublic: false }]))) {
    throw new Error("The local activity summary could not be updated.")
  }
  applyActivityMetadata([updated])
}

interface PublicActivityActionArgs {
  profileHandle: string | undefined
  request: Request
}

export async function handlePublicActivityAction({
  profileHandle,
  request,
}: PublicActivityActionArgs): Promise<PublicActivityActionResult> {
  const formData = await request.formData()
  if (formData.get("intent") !== "hide-activity") {
    return failedHide("Unknown profile action.")
  }

  const contentHash = formData.get("contentHash")
  if (typeof contentHash !== "string" || !CONTENT_HASH_RE.test(contentHash)) {
    return failedHide("Activity identity is invalid.")
  }

  await initAuth()
  const auth = getAuthState()
  if (auth.status !== "signedIn" || !canSync()) {
    return failedHide("Sign in with sync access to manage public activities.")
  }
  if (
    !profileHandle ||
    !auth.user.handle ||
    auth.user.handle.toLowerCase() !== profileHandle.toLowerCase()
  ) {
    return failedHide("You can only manage activities on your own profile.")
  }

  try {
    await updateActivityVisibility(contentHash, false)
  } catch (err) {
    return failedHide(friendlyMessage(err))
  }

  try {
    await reconcileLocalVisibility(contentHash)
  } catch (err) {
    console.warn(
      "[public-profile] local visibility reconciliation failed:",
      err
    )
  }

  return { ok: true, intent: "hide-activity", contentHash }
}
