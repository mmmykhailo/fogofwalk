import { SAVED_POINT_COLORS, type SavedPointColor } from "~shared/saved-points"

export const SAVED_POINT_MARKER_PIXEL_RATIO = 2
export const SAVED_POINT_MARKER_SIZE = 22

const SAVED_POINT_MARKER_BODY_RADIUS = 10
const SAVED_POINT_MARKER_STROKE_WIDTH = 1
const SAVED_POINT_MARKER_CENTRE_RADIUS = 3.5
const SUPERSAMPLE_SIZE = 4

export interface SavedPointMarkerImage {
  width: number
  height: number
  data: Uint8ClampedArray
  pixelRatio: number
}

interface SavedPointMarkerImageMap {
  hasImage: (id: string) => boolean
  addImage: (
    id: string,
    image: { width: number; height: number; data: Uint8ClampedArray },
    options: { pixelRatio: number }
  ) => unknown
}

export function savedPointMarkerImageId(color: SavedPointColor): string {
  return `saved-point-marker-${color}`
}

function hexChannel(value: string): number {
  return Number.parseInt(value, 16)
}

function paletteRgb(color: SavedPointColor): [number, number, number] {
  const hex = SAVED_POINT_COLORS[color]
  return [
    hexChannel(hex.slice(1, 3)),
    hexChannel(hex.slice(3, 5)),
    hexChannel(hex.slice(5, 7)),
  ]
}

function pixelColor(
  distance: number,
  rgb: [number, number, number]
): [number, number, number, number] {
  if (distance <= SAVED_POINT_MARKER_CENTRE_RADIUS) {
    return [255, 255, 255, 255]
  }
  if (distance <= SAVED_POINT_MARKER_BODY_RADIUS) {
    return [rgb[0], rgb[1], rgb[2], 255]
  }
  if (
    distance <=
    SAVED_POINT_MARKER_BODY_RADIUS + SAVED_POINT_MARKER_STROKE_WIDTH
  ) {
    return [255, 255, 255, 255]
  }
  return [0, 0, 0, 0]
}

/** Generates one antialiased marker without relying on browser canvas APIs. */
export function generateSavedPointMarkerImage(
  color: SavedPointColor
): SavedPointMarkerImage {
  const width = SAVED_POINT_MARKER_SIZE * SAVED_POINT_MARKER_PIXEL_RATIO
  const height = width
  const data = new Uint8ClampedArray(width * height * 4)
  const rgb = paletteRgb(color)
  const sampleStep = 1 / SUPERSAMPLE_SIZE

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colours = [0, 0, 0, 0]
      for (let sampleY = 0; sampleY < SUPERSAMPLE_SIZE; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPERSAMPLE_SIZE; sampleX += 1) {
          const logicalX =
            (x + (sampleX + 0.5) * sampleStep) /
              SAVED_POINT_MARKER_PIXEL_RATIO -
            SAVED_POINT_MARKER_SIZE / 2
          const logicalY =
            (y + (sampleY + 0.5) * sampleStep) /
              SAVED_POINT_MARKER_PIXEL_RATIO -
            SAVED_POINT_MARKER_SIZE / 2
          const distance = Math.hypot(logicalX, logicalY)
          const sample = pixelColor(distance, rgb)
          colours[0] += sample[0]
          colours[1] += sample[1]
          colours[2] += sample[2]
          colours[3] += sample[3]
        }
      }

      const sampleCount = SUPERSAMPLE_SIZE * SUPERSAMPLE_SIZE
      const offset = (y * width + x) * 4
      data[offset] = Math.round(colours[0] / sampleCount)
      data[offset + 1] = Math.round(colours[1] / sampleCount)
      data[offset + 2] = Math.round(colours[2] / sampleCount)
      data[offset + 3] = Math.round(colours[3] / sampleCount)
    }
  }

  return {
    width,
    height,
    data,
    pixelRatio: SAVED_POINT_MARKER_PIXEL_RATIO,
  }
}

export function ensureSavedPointMarkerImages(
  map: SavedPointMarkerImageMap
): void {
  for (const color of Object.keys(SAVED_POINT_COLORS) as SavedPointColor[]) {
    const id = savedPointMarkerImageId(color)
    if (map.hasImage(id)) continue

    const image = generateSavedPointMarkerImage(color)
    map.addImage(
      id,
      { width: image.width, height: image.height, data: image.data },
      { pixelRatio: image.pixelRatio }
    )
  }
}
