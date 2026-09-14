import { describe, expect, test } from "bun:test"
import {
  computePhotoClusters,
  diffPhotoMarkerGroups,
  photoMarkerCacheKey,
} from "~/components/map/usePhotoMarkers"
import type { PhotoEntry } from "~/types/photos"

function photo(
  id: string,
  lng: number,
  lat: number,
  takenAtMs: number
): PhotoEntry {
  return { id, lng, lat, takenAtMs, file: {} as File }
}

function group(id: string, photos: PhotoEntry[], lng = 0, lat = 0) {
  return { id, photos, lng, lat }
}

describe("computePhotoClusters", () => {
  test("groups nearby photos with stable ids and chronological members", () => {
    const groups = computePhotoClusters(
      [photo("b", 10, 10, 2), photo("a", 11, 11, 1), photo("c", 80, 80, 3)],
      ([x, y]) => ({ x, y })
    )

    expect(groups).toHaveLength(2)
    expect(groups[0].id).toBe("a|b")
    expect(groups[0].photos.map(({ id }) => id)).toEqual(["a", "b"])
    expect(groups[0].lng).toBe(10.5)
    expect(groups[0].lat).toBe(10.5)
    expect(groups[1].id).toBe("c")
  })

  test("assigns groups in photo id order instead of input order", () => {
    const groups = computePhotoClusters(
      [photo("c", 80, 0, 3), photo("b", 40, 0, 2), photo("a", 0, 0, 1)],
      ([x, y]) => ({ x, y })
    )

    expect(groups.map(({ id }) => id)).toEqual(["a|b", "c"])
  })

  test("returns no groups for no photos", () => {
    expect(computePhotoClusters([], () => ({ x: 0, y: 0 }))).toEqual([])
  })

  test("invalidates the cluster cache only when one cache input changes", () => {
    expect(photoMarkerCacheKey(4, true, 8)).toBe(
      photoMarkerCacheKey(4, true, 8)
    )
    expect(photoMarkerCacheKey(5, true, 8)).not.toBe(
      photoMarkerCacheKey(4, true, 8)
    )
    expect(photoMarkerCacheKey(4, false, 8)).not.toBe(
      photoMarkerCacheKey(4, true, 8)
    )
    expect(photoMarkerCacheKey(4, true, 9)).not.toBe(
      photoMarkerCacheKey(4, true, 8)
    )
  })

  test("diffs marker membership, centroid, and content without rebuilding unchanged markers", () => {
    const unchanged = photo("unchanged", 1, 1, 1)
    const moved = photo("moved", 2, 2, 2)
    const replaced = photo("replaced", 3, 3, 3)
    const removed = photo("removed", 4, 4, 4)
    const added = photo("added", 5, 5, 5)
    const current = new Map([
      ["unchanged", group("unchanged", [unchanged])],
      ["moved", group("moved", [moved], 0, 0)],
      ["replaced", group("replaced", [replaced])],
      ["removed", group("removed", [removed])],
    ])
    const diff = diffPhotoMarkerGroups(current, [
      group("unchanged", [unchanged]),
      group("moved", [moved], 1, 1),
      group("replaced", [photo("replaced", 3, 3, 4)]),
      group("added", [added]),
    ])

    expect([...diff.removed]).toEqual(["removed"])
    expect([...diff.added]).toEqual(["added"])
    expect([...diff.moved]).toEqual(["moved"])
    expect([...diff.updated]).toEqual(["replaced"])
    expect(diff.nextById.get("unchanged")).toEqual(
      group("unchanged", [unchanged])
    )
  })
})
