import { describe, expect, test } from "bun:test"
import { computePhotoClusters } from "~/components/map/usePhotoMarkers"
import type { PhotoEntry } from "~/types/photos"

function photo(
  id: string,
  lng: number,
  lat: number,
  takenAtMs: number
): PhotoEntry {
  return { id, lng, lat, takenAtMs, file: {} as File }
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

  test("returns no groups for no photos", () => {
    expect(computePhotoClusters([], () => ({ x: 0, y: 0 }))).toEqual([])
  })
})
