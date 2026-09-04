import { isActivityType } from "~/lib/activityType"
import type { ActivityType, ParsedActivity } from "~/types/activities"

export const NO_ACTIVITY_SELECTION = "no-activity-selection" as const
export const MIXED_PUBLICITY = "mixed-publicity" as const
export const UNSET_ACTIVITY_TYPE = "unset-activity-type" as const
export const MIXED_ACTIVITY_TYPE = "mixed-activity-type" as const

export type ActivitySetting = "publicity" | "activityType"

export type ActivitySettingValue = boolean | ActivityType

export type CommonPublicity =
  | typeof NO_ACTIVITY_SELECTION
  | typeof MIXED_PUBLICITY
  | boolean

export type CommonActivityType =
  | typeof NO_ACTIVITY_SELECTION
  | typeof UNSET_ACTIVITY_TYPE
  | typeof MIXED_ACTIVITY_TYPE
  | ActivityType

export function commonPublicity(
  activities: readonly ParsedActivity[]
): CommonPublicity {
  if (activities.length === 0) return NO_ACTIVITY_SELECTION
  const first = activities[0]!.isPublic ?? false
  return activities.every((activity) => (activity.isPublic ?? false) === first)
    ? first
    : MIXED_PUBLICITY
}

export function commonActivityType(
  activities: readonly ParsedActivity[]
): CommonActivityType {
  if (activities.length === 0) return NO_ACTIVITY_SELECTION
  const first = activities[0]!.activityType
  if (activities.every((activity) => activity.activityType === first)) {
    return first ?? UNSET_ACTIVITY_TYPE
  }
  return MIXED_ACTIVITY_TYPE
}

export type ParsedActivitySettingsUpdate =
  | {
      ok: true
      activityIds: string[]
      setting: "publicity"
      value: boolean
    }
  | {
      ok: true
      activityIds: string[]
      setting: "activityType"
      value: ActivityType
    }
  | { ok: false; error: string }

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

  if (setting === "publicity") {
    if (value !== "true" && value !== "false") {
      return { ok: false, error: "Choose a valid publicity value." }
    }
    return { ok: true, activityIds, setting, value: value === "true" }
  }

  if (setting === "activityType") {
    if (!isActivityType(value)) {
      return { ok: false, error: "Choose a valid activity type." }
    }
    return { ok: true, activityIds, setting, value }
  }

  return { ok: false, error: "Choose a valid activity setting." }
}
