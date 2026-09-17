import { expect, test } from "bun:test"
import { gzipSync } from "node:zlib"

import { encodeMvtTile } from "../src/mvt"
import { tileRangeForCoordinates } from "../src/geometry"
import {
  deserializeDirectory,
  serializeDirectory,
  writePmtilesArchive,
} from "../src/pmtiles-writer"
import { verifyArchive } from "../src/verify"

const feature = {
  type: "Feature" as const,
  id: 1,
  wayId: 1,
  properties: {
    kind: "hiking" as const,
    color: "#d9272e",
    offset: 0,
    sort: 13,
  },
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [14, 50],
      [14.1, 50.1],
    ] as [number, number][],
  },
}

const metadata = {
  tilejson: "3.0.0",
  name: "test trails",
  version: "1",
  format: "pbf",
  attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  dataLicense: "ODbL-1.0",
  bounds: [14, 50, 14.1, 50.1],
  vector_layers: [
    {
      id: "trails",
      minzoom: 12,
      maxzoom: 12,
      fields: {
        kind: "String",
        color: "String",
        offset: "Number",
        sort: "Number",
      },
    },
  ],
}

test("serializes PMTiles directories with contiguous offsets", () => {
  const entries = [
    { tileId: 10, offset: 0, length: 4, runLength: 1 },
    { tileId: 11, offset: 4, length: 5, runLength: 1 },
  ]
  expect(deserializeDirectory(serializeDirectory(entries))).toEqual(entries)
})

test("writes and independently verifies a small archive with leaf directories", async () => {
  const archive = `/tmp/fogofwalk-pmtiles-${crypto.randomUUID()}.pmtiles`
  const range = tileRangeForCoordinates(feature.geometry.coordinates, 12)
  const tile = encodeMvtTile([feature], 12, range.minX, range.minY)
  if (!tile) throw new Error("test feature did not intersect its tile")
  const tileIds = [
    [range.minX, range.minY],
    [range.minX, range.minY + 1],
    [range.minX + 1, range.minY],
    [range.minX + 1, range.minY + 1],
    [range.minX + 2, range.minY],
  ]
  const result = await writePmtilesArchive({
    output: archive,
    metadata,
    bounds: { minLon: 14, minLat: 50, maxLon: 14.1, maxLat: 50.1 },
    leafSize: 2,
    forceLeafDirectories: true,
    tiles: (async function* () {
      const { zxyToTileId } = await import("pmtiles")
      for (const [x, y] of tileIds.sort(
        (a, b) => zxyToTileId(12, a[0], a[1]) - zxyToTileId(12, b[0], b[1])
      )) {
        yield {
          tileId: zxyToTileId(12, x, y),
          bytes: gzipSync(tile),
          featureCount: 1,
        }
      }
    })(),
  })
  expect(result.usedLeafDirectories).toBe(true)
  const verified = await verifyArchive({ archive })
  expect(verified.tileCount).toBe(5)
  expect(verified.featureCount).toBe(5)
  expect(verified.header.leafDirectoryLength).toBeGreaterThan(0)
})
