import { HASH_COORD_PRECISION } from "./constants"
import type {
  ActivityCoords,
  ActivityPaths,
  CanonicalActivity,
  ParsedActivity,
} from "./activities"
import { flattenActivityPaths } from "./activityContract"

export const LEGACY_ACTIVITY_IDENTITY_VERSION = 1
export const ACTIVITY_IDENTITY_VERSION = 2
export type ActivityIdentityVersion = 1 | 2
export const CONTENT_HASH_RE = /^[a-f0-9]{64}$/

export function isContentHash(value: string): boolean {
  return CONTENT_HASH_RE.test(value)
}

export type ActivityIdentityInput = Pick<
  ParsedActivity,
  "format" | "startedAtMs"
> &
  Partial<Pick<ParsedActivity, "coordinates">> &
  Partial<Pick<CanonicalActivity, "paths">>

function formatPoint([lng, lat]: ActivityCoords[number]): string {
  return `${lng.toFixed(HASH_COORD_PRECISION)},${lat.toFixed(HASH_COORD_PRECISION)}`
}

function legacyIdentityString(
  activity: ActivityIdentityInput & { coordinates: ActivityCoords }
): string {
  const points = activity.coordinates.map(formatPoint).join(";")
  return `${activity.format}|${activity.startedAtMs ?? ""}|${activity.coordinates.length}|${points}`
}

function pathIdentityString(
  activity: ActivityIdentityInput & { paths: ActivityPaths }
): string {
  const paths = activity.paths
    .map((path) => `${path.length}:${path.map(formatPoint).join(";")}`)
    .join("|")
  return `v${ACTIVITY_IDENTITY_VERSION}|${activity.format}|${activity.startedAtMs ?? ""}|${activity.paths.length}|${paths}`
}

/**
 * Serialize the identity input. Legacy flat activities retain their exact
 * v1 wire form; canonical activities use v2, whose path count, path lengths,
 * and separators make disconnected geometry impossible to flatten silently.
 */
export function canonicalActivityIdentityString(
  activity: ActivityIdentityInput,
  version: ActivityIdentityVersion = "paths" in activity && activity.paths
    ? ACTIVITY_IDENTITY_VERSION
    : LEGACY_ACTIVITY_IDENTITY_VERSION
): string {
  if (version === LEGACY_ACTIVITY_IDENTITY_VERSION) {
    if (activity.coordinates) return legacyIdentityString(activity as never)
    if (activity.paths) {
      return legacyIdentityString({
        ...activity,
        coordinates: flattenActivityPaths(activity.paths),
      })
    }
    throw new Error("Activity identity requires coordinates or paths.")
  }
  if (!activity.paths) {
    if (!activity.coordinates) {
      throw new Error("Activity identity requires coordinates or paths.")
    }
    return pathIdentityString({ ...activity, paths: [activity.coordinates] })
  }
  return pathIdentityString(
    activity as ActivityIdentityInput & { paths: ActivityPaths }
  )
}
