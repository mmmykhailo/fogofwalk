import { ACTIVITY_TYPES, type ActivityType } from "~/types/activities"

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  kayaking: "Kayaking",
  swimming: "Swimming",
  other: "Other",
}

export function isActivityType(value: unknown): value is ActivityType {
  return (
    typeof value === "string" &&
    (ACTIVITY_TYPES as readonly string[]).includes(value)
  )
}

const WALKING_TYPES = new Set([
  "hike",
  "hiking",
  "indoor_walking",
  "mountaineering",
  "walk",
  "walking",
])

const RUNNING_TYPES = new Set([
  "indoor_running",
  "jog",
  "jogging",
  "run",
  "running",
  "trail_running",
])

const CYCLING_TYPES = new Set([
  "bicycle",
  "bike",
  "biking",
  "cycling",
  "e_biking",
  "indoor_cycling",
  "mountain_biking",
  "ride",
])

const KAYAKING_TYPES = new Set([
  "canoe",
  "canoeing",
  "kayak",
  "kayaking",
  "paddle",
  "paddling",
])

const SWIMMING_TYPES = new Set([
  "lap_swimming",
  "open_water_swimming",
  "swim",
  "swimming",
])

/**
 * Coarsen parser-specific activity names into the categories supported by the
 * app. An unknown, non-empty source value still carries information, so it is
 * categorized as "other"; only a missing value stays undefined.
 */
export function normalizeActivityType(
  value: unknown
): ActivityType | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  if (!normalized) return undefined
  if (WALKING_TYPES.has(normalized)) return "walking"
  if (RUNNING_TYPES.has(normalized)) return "running"
  if (CYCLING_TYPES.has(normalized)) return "cycling"
  if (KAYAKING_TYPES.has(normalized)) return "kayaking"
  if (SWIMMING_TYPES.has(normalized)) return "swimming"
  return "other"
}
