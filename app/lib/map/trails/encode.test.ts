import { describe, expect, test } from "bun:test"
import { VectorTile } from "@mapbox/vector-tile"
import Pbf from "pbf"
import { TRAIL_SOURCE_LAYER } from "~/constants/trails"
import { encodeTrailTile, createEmptyTrailTile } from "~/lib/map/trails/encode"
import { normalizeTrailTile } from "~/lib/map/trails/normalize"
import type { TrailTileCoordinate } from "~/lib/map/trails/types"
import hikingOverlap from "~/lib/map/trails/fixtures/hiking-overlap.json"

const tileCoordinate: TrailTileCoordinate = {
  theme: "hiking",
  z: 12,
  x: 2212,
  y: 1387,
}

function decode(buffer: ArrayBuffer) {
  return new VectorTile(new Pbf(buffer)).layers[TRAIL_SOURCE_LAYER]
}

describe("trail tile encoding", () => {
  test("encodes one source layer with geometry and scalar properties", () => {
    const normalized = normalizeTrailTile(hikingOverlap, "hiking")
    const layer = decode(encodeTrailTile(normalized, tileCoordinate))

    expect(layer).toBeDefined()
    expect(layer?.name).toBe(TRAIL_SOURCE_LAYER)
    expect(layer?.length).toBe(4)

    const features = Array.from({ length: layer?.length ?? 0 }, (_, index) =>
      layer!.feature(index)
    )
    expect(features.map((feature) => feature.id)).toEqual([0, 1, 2, 3])
    expect(features.map((feature) => feature.properties)).toEqual([
      { kind: "hiking", color: "#d9272e", offset: -4.5, sort: 10 },
      { kind: "hiking", color: "#15803d", offset: -1.5, sort: 10 },
      { kind: "hiking", color: "#1769aa", offset: 1.5, sort: 10 },
      { kind: "hiking", color: "#eab308", offset: 4.5, sort: 10 },
    ])
    expect(features.every((feature) => feature.type === 2)).toBe(true)
    expect(features.every((feature) => feature.loadGeometry().length > 0)).toBe(
      true
    )
    expect(Object.keys(features[0]?.properties ?? {}).sort()).toEqual([
      "color",
      "kind",
      "offset",
      "sort",
    ])
  })

  test("encodes a valid empty tile and returns a fresh buffer each time", () => {
    const first = createEmptyTrailTile()
    const second = createEmptyTrailTile()
    expect(first.byteLength).toBeGreaterThan(0)
    expect(first).not.toBe(second)
    expect(decode(first)?.length ?? 0).toBe(0)
    expect(decode(second)?.length ?? 0).toBe(0)

    new Uint8Array(first)[0] = 0
    expect(new Uint8Array(second)[0]).not.toBe(0)
  })
})
