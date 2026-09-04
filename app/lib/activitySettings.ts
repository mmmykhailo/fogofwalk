import { isActivityType } from "~/lib/activityType"
import type { ActivityType } from "~/types/activities"

export type ActivitySetting = "publicity" | "activityType"

export type ActivitySettingValue = boolean | ActivityType

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
