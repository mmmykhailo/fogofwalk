import exifr from "exifr"
import type { ParsedActivity } from "~/types/activities"
import type { PhotoEntry } from "~/types/photos"
import { createUuid } from "~/lib/uuid"
import { haversineMeters } from "~/lib/geo"
import {
  pathTimestampsForActivity,
  pathsForActivity,
} from "~shared/activityContract"

const MATCH_TOLERANCE_MS = 5 * 60 * 1000

export async function readExifTimestamp(file: File): Promise<number | null> {
  try {
    const tags = await exifr.parse(file, ["DateTimeOriginal", "DateTime"])
    const dt = tags?.DateTimeOriginal ?? tags?.DateTime
    if (!dt) return null
    if (dt instanceof Date) return dt.getTime()
    const ms = Date.parse(
      String(dt).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    )
    return isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

export function matchPhotoToActivity(
  photoMs: number,
  activities: ParsedActivity[]
): { lng: number; lat: number } | null {
  let bestDt = Infinity
  let bestCoord: [number, number] | null = null

  for (const activity of activities) {
    const timestamps = pathTimestampsForActivity(activity)
    if (!timestamps) continue
    const paths = pathsForActivity(activity)
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths[pathIndex]!
      const ts = timestamps[pathIndex] ?? []
      for (let i = 0; i < Math.min(ts.length, path.length); i += 1) {
        const t = ts[i]
        if (t == null || t < 0) continue
        const dt = Math.abs(t - photoMs)
        if (dt < bestDt && dt <= MATCH_TOLERANCE_MS) {
          bestDt = dt
          bestCoord = path[i]!
        }
      }
    }
  }

  return bestCoord ? { lng: bestCoord[0], lat: bestCoord[1] } : null
}

export async function processPhotoFiles(
  files: File[],
  activities: ParsedActivity[],
  existingPhotos: PhotoEntry[]
): Promise<PhotoEntry[]> {
  const newEntries: PhotoEntry[] = []

  for (const file of files) {
    const takenAtMs = await readExifTimestamp(file)
    if (takenAtMs == null) continue

    const match = matchPhotoToActivity(takenAtMs, activities)
    if (!match) continue

    // Skip if this exact file was already added (same name + timestamp)
    const alreadyExists = existingPhotos.some(
      (p) => p.file.name === file.name && p.takenAtMs === takenAtMs
    )
    if (alreadyExists) continue

    // Skip if a photo was taken at the exact same moment (genuine duplicate)
    const isDuplicate = existingPhotos.some(
      (p) =>
        p.takenAtMs === takenAtMs &&
        haversineMeters([p.lng, p.lat], [match.lng, match.lat]) < 1
    )
    if (isDuplicate) continue

    newEntries.push({
      id: createUuid(),
      file,
      takenAtMs,
      lng: match.lng,
      lat: match.lat,
    })
  }

  return newEntries
}
