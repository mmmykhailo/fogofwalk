import { describe, expect, test } from "bun:test"
import {
  generateSavedPointMarkerImage,
  SAVED_POINT_MARKER_PIXEL_RATIO,
  SAVED_POINT_MARKER_SIZE,
  savedPointMarkerImageId,
  ensureSavedPointMarkerImages,
} from "~/lib/map/savedPointMarkerImages"
import { SAVED_POINT_COLORS } from "~shared/saved-points"

function sampleLogicalPixel(
  image: ReturnType<typeof generateSavedPointMarkerImage>,
  logicalX: number,
  logicalY: number
): [number, number, number, number] {
  const x = Math.floor(
    (logicalX + SAVED_POINT_MARKER_SIZE / 2) * image.pixelRatio
  )
  const y = Math.floor(
    (logicalY + SAVED_POINT_MARKER_SIZE / 2) * image.pixelRatio
  )
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ]
}

describe("saved-point marker images", () => {
  test("keeps the logical marker size and pixel ratio", () => {
    const image = generateSavedPointMarkerImage("blue")

    expect(image.width).toBe(
      SAVED_POINT_MARKER_SIZE * SAVED_POINT_MARKER_PIXEL_RATIO
    )
    expect(image.height).toBe(
      SAVED_POINT_MARKER_SIZE * SAVED_POINT_MARKER_PIXEL_RATIO
    )
    expect(image.pixelRatio).toBe(SAVED_POINT_MARKER_PIXEL_RATIO)
  })

  test("contains a white centre, coloured body, white stroke, and transparent outside", () => {
    const image = generateSavedPointMarkerImage("blue")

    expect(sampleLogicalPixel(image, 0, 0)).toEqual([255, 255, 255, 255])
    expect(sampleLogicalPixel(image, 7, 0)).toEqual([37, 99, 235, 255])
    expect(sampleLogicalPixel(image, 10.5, 0)).toEqual([255, 255, 255, 255])
    expect(sampleLogicalPixel(image, -10, -10)).toEqual([0, 0, 0, 0])
  })

  test("registers one reusable image per palette colour and is idempotent", () => {
    const images = new Set<string>()
    const additions: { id: string; pixelRatio: number }[] = []
    const map = {
      hasImage: (id: string) => images.has(id),
      addImage: (
        id: string,
        _image: unknown,
        options?: { pixelRatio?: number }
      ) => {
        images.add(id)
        additions.push({ id, pixelRatio: options?.pixelRatio ?? 0 })
      },
    }

    ensureSavedPointMarkerImages(map)
    expect(additions).toHaveLength(Object.keys(SAVED_POINT_COLORS).length)
    expect(additions.map(({ id }) => id)).toEqual(
      (
        Object.keys(SAVED_POINT_COLORS) as (keyof typeof SAVED_POINT_COLORS)[]
      ).map(savedPointMarkerImageId)
    )
    expect(additions.every(({ pixelRatio }) => pixelRatio === 2)).toBe(true)

    ensureSavedPointMarkerImages(map)
    expect(additions).toHaveLength(Object.keys(SAVED_POINT_COLORS).length)

    images.clear()
    ensureSavedPointMarkerImages(map)
    expect(additions).toHaveLength(Object.keys(SAVED_POINT_COLORS).length * 2)
  })
})
