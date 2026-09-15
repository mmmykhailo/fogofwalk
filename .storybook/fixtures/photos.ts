import type { PhotoEntry, PhotoGroup } from "~/types/photos"

import { FIXTURE_ACTIVITY_START_MS } from "./activities"

export const FIXTURE_PHOTO_TIME_MS = FIXTURE_ACTIVITY_START_MS + 1_200_000

export function makePhoto(overrides: Partial<PhotoEntry> = {}): PhotoEntry {
  const file =
    overrides.file ??
    new File(["fog-of-walk-story-photo"], "riverside.jpg", {
      type: "image/jpeg",
      lastModified: FIXTURE_PHOTO_TIME_MS,
    })

  return {
    id: "photo-fixture-1",
    takenAtMs: FIXTURE_PHOTO_TIME_MS,
    lng: 14.4268,
    lat: 50.0801,
    ...overrides,
    file,
  }
}

export function makePhotoGroup(
  overrides: Partial<PhotoGroup> = {}
): PhotoGroup {
  const photos = overrides.photos?.map((photo) => ({ ...photo })) ?? [
    makePhoto(),
  ]
  return {
    id: "photo-group-fixture-1",
    lng: photos[0]?.lng ?? 14.4268,
    lat: photos[0]?.lat ?? 50.0801,
    ...overrides,
    photos,
  }
}
