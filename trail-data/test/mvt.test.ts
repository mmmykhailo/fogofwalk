import { expect, test } from "bun:test"

import { VectorTile } from "@mapbox/vector-tile"
import Pbf from "pbf"

import { tileRangeForCoordinates } from "../src/geometry"
import { encodeMvtTile } from "../src/mvt"

test("clips a line crossing a z12 boundary into both adjacent tiles", () => {
  const zoom = 12
  const boundaryX = 2000
  const boundaryLongitude = (boundaryX / 2 ** zoom) * 360 - 180
  const coordinates = [
    [boundaryLongitude - 0.02, 50],
    [boundaryLongitude + 0.02, 50.01],
  ] as [number, number][]
  const feature = {
    type: "Feature" as const,
    id: 2000,
    wayId: 125,
    properties: {
      kind: "hiking" as const,
      color: "#d9272e",
      offset: 0,
      sort: 13,
    },
    geometry: { type: "LineString" as const, coordinates },
  }
  const range = tileRangeForCoordinates(coordinates, zoom)
  expect(range.maxX - range.minX).toBe(1)

  const leftGeometries = [range.minY, range.maxY].flatMap((y) => {
    const tile = encodeMvtTile([feature], zoom, range.minX, y)
    return tile ? [decodeGeometry(tile)] : []
  })
  const rightGeometries = [range.minY, range.maxY].flatMap((y) => {
    const tile = encodeMvtTile([feature], zoom, range.maxX, y)
    return tile ? [decodeGeometry(tile)] : []
  })
  const leftGeometry = leftGeometries.flat()
  const rightGeometry = rightGeometries.flat()
  expect(leftGeometry.length).toBeGreaterThanOrEqual(2)
  expect(rightGeometry.length).toBeGreaterThanOrEqual(2)
  expect(Math.max(...leftGeometry.map(([x]) => x))).toBeGreaterThan(4000)
  expect(Math.min(...rightGeometry.map(([x]) => x))).toBeLessThan(100)
})

function decodeGeometry(bytes: Uint8Array): Array<[number, number]> {
  const layer = new VectorTile(new Pbf(bytes)).layers.trails
  if (!layer) throw new Error("missing trails layer")
  const geometry = layer.feature(0)?.loadGeometry().flat() ?? []
  return geometry.map((point) => [point.x, point.y])
}
