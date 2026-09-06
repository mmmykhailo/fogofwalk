import { isActivityType } from "~/lib/activityType"
import type { ActivityType, ParsedActivity } from "~/types/activities"

type ActivitySettingsItem = Pick<ParsedActivity, "isPublic" | "activityType">

export const NO_ACTIVITY_SELECTION = "no-activity-selection" as const
export const MIXED_VISIBILITY = "mixed-visibility" as const
export const UNSET_ACTIVITY_TYPE = "unset-activity-type" as const
export const MIXED_ACTIVITY_TYPE = "mixed-activity-type" as const

export type ActivitySetting = "visibility" | "activityType"

export type ActivitySettingValue = boolean | ActivityType

export type CommonVisibility =
  | typeof NO_ACTIVITY_SELECTION
  | typeof MIXED_VISIBILITY
  | boolean

export type CommonActivityType =
  | typeof NO_ACTIVITY_SELECTION
  | typeof UNSET_ACTIVITY_TYPE
  | typeof MIXED_ACTIVITY_TYPE
  | ActivityType

export function commonVisibility(
  activities: readonly ActivitySettingsItem[]
): CommonVisibility {
  if (activities.length === 0) return NO_ACTIVITY_SELECTION
  const first = activities[0]!.isPublic ?? false
  return activities.every((activity) => (activity.isPublic ?? false) === first)
    ? first
    : MIXED_VISIBILITY
}

export function commonActivityType(
  activities: readonly ActivitySettingsItem[]
): CommonActivityType {
  if (activities.length === 0) return NO_ACTIVITY_SELECTION
  const first = activities[0]!.activityType
  if (activities.every((activity) => activity.activityType === first)) {
    return first ?? UNSET_ACTIVITY_TYPE
  }
  return MIXED_ACTIVITY_TYPE
}

export type ActivitySettingUpdate =
  | {
      activityIds: string[]
      setting: "visibility"
      value: boolean
    }
  | {
      activityIds: string[]
      setting: "activityType"
      value: ActivityType
    }

export type ParsedActivitySettingsUpdate =
  | ({ ok: true } & ActivitySettingUpdate)
  | { ok: false; error: string }

export type ActivitySettingsActionResult =
  | ({ ok: true; updatedActivityIds: string[] } & Omit<
      ActivitySettingUpdate,
      "activityIds"
    >)
  | { ok: false; error: string }

/** Serializes the shared card and bulk activity-settings action contract. */
export function createActivitySettingsFormData(
  update: ActivitySettingUpdate
): FormData {
  const formData = new FormData()
  formData.set("intent", "update-activity-settings")
  for (const activityId of update.activityIds) {
    formData.append("activityId", activityId)
  }
  formData.set("setting", update.setting)
  formData.set("value", String(update.value))
  return formData
}

/** Parse the shared route action contract used by card and bulk controls. */
export function parseActivitySettingsUpdate(
  formData: FormData
): ParsedActivitySettingsUpdate {
  const rawActivityIds = formData.getAll("activityId")
  if (
    rawActivityIds.length === 0 ||
    rawActivityIds.some(
      (activityId) => typeof activityId !== "string" || activityId.length === 0
    )
  ) {
    return { ok: false, error: "At least one activity is required." }
  }

  const activityIds = [...new Set(rawActivityIds as string[])]
  const setting = formData.get("setting")
  const value = formData.get("value")

  // Accept the former form value while callers migrate to the user-facing
  // visibility terminology.
  if (setting === "visibility" || setting === "publicity") {
    if (value !== "true" && value !== "false") {
      return { ok: false, error: "Choose a valid visibility value." }
    }
    return {
      ok: true,
      activityIds,
      setting: "visibility",
      value: value === "true",
    }
  }

  if (setting === "activityType") {
    if (!isActivityType(value)) {
      return { ok: false, error: "Choose a valid activity type." }
    }
    return { ok: true, activityIds, setting, value }
  }

  return { ok: false, error: "Choose a valid activity setting." }
}
