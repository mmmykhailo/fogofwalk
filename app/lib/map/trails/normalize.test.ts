import { describe, expect, test } from "bun:test"
import {
  TRAIL_MAX_COORDINATES_PER_FEATURE,
  TRAIL_MAX_FEATURES_PER_TILE,
} from "~/constants/trails"
import { normalizeTrailTile } from "~/lib/map/trails/normalize"
import { TrailTileError } from "~/lib/map/trails/types"
import hikingKct from "~/lib/map/trails/fixtures/hiking-kct.json"
import hikingOverlap from "~/lib/map/trails/fixtures/hiking-overlap.json"
import mixedInvalid from "~/lib/map/trails/fixtures/mixed-invalid.json"
import empty from "~/lib/map/trails/fixtures/empty.json"

describe("trail normalization", () => {
  test("keeps KCT lines and uses the fallback for other hiking shields", () => {
    const result = normalizeTrailTile(hikingKct, "hiking")

    expect(result.stats).toEqual({
      inputFeatures: 5,
      outputFeatures: 5,
      droppedFeatures: 0,
      coordinateCount: 10,
    })
    expect(
      result.collection.features.map((feature) => feature.properties.color)
    ).toEqual(["#d9272e", "#15803d", "#1769aa", "#eab308", "#7e22ce"])
    for (const feature of result.collection.features) {
      expect(Object.keys(feature.properties).sort()).toEqual([
        "color",
        "kind",
        "offset",
        "sort",
      ])
      expect(feature.geometry.type).toBe("LineString")
    }
  })

  test("duplicates overlapping lines in deterministic centered order", () => {
    const result = normalizeTrailTile(hikingOverlap, "hiking")

    expect(result.stats.outputFeatures).toBe(4)
    expect(
      result.collection.features.map((feature) => feature.properties.color)
    ).toEqual(["#d9272e", "#15803d", "#1769aa", "#eab308"])
    expect(
      result.collection.features.map((feature) => feature.properties.offset)
    ).toEqual([-4.5, -1.5, 1.5, 4.5])
    expect(result.collection.features.map((feature) => feature.id)).toEqual([
      0, 1, 2, 3,
    ])
  })

  test("drops guideposts, unsupported geometry, malformed features, and unknown objects locally", () => {
    const result = normalizeTrailTile(mixedInvalid, "hiking")

    expect(result.stats).toEqual({
      inputFeatures: 7,
      outputFeatures: 2,
      droppedFeatures: 5,
      coordinateCount: 6,
    })
    expect(
      result.collection.features.map((feature) => feature.geometry.type)
    ).toEqual(["LineString", "MultiLineString"])
  })

  test("normalizes cycling lines without retaining provider properties", () => {
    const result = normalizeTrailTile(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              type: "way",
              shields: ["red:white:red"],
              top_relations: ["private-relation"],
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [1500000, 6400000],
                [1500100, 6400100],
              ],
            },
          },
        ],
      },
      "cycling"
    )

    expect(result.collection.features[0]?.properties).toEqual({
      kind: "cycling",
      color: "#ec4899",
      offset: 0,
      sort: 20,
    })
  })

  test("accepts a valid empty collection", () => {
    expect(normalizeTrailTile(empty, "hiking")).toEqual({
      collection: { type: "FeatureCollection", features: [] },
      stats: {
        inputFeatures: 0,
        outputFeatures: 0,
        droppedFeatures: 0,
        coordinateCount: 0,
      },
    })
  })

  test("rejects malformed collections and feature/coordinate overflows", () => {
    expect(() => normalizeTrailTile({}, "hiking")).toThrow(TrailTileError)
    expect(() =>
      normalizeTrailTile({ type: "FeatureCollection", features: {} }, "hiking")
    ).toThrow(TrailTileError)

    expect(() =>
      normalizeTrailTile(
        {
          type: "FeatureCollection",
          features: Array.from(
            { length: TRAIL_MAX_FEATURES_PER_TILE + 1 },
            () => null
          ),
        },
        "hiking"
      )
    ).toThrow(TrailTileError)

    expect(() =>
      normalizeTrailTile(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { type: "way" },
              geometry: {
                type: "LineString",
                coordinates: Array.from(
                  { length: TRAIL_MAX_COORDINATES_PER_FEATURE + 1 },
                  () => [0, 0]
                ),
              },
            },
          ],
        },
        "hiking"
      )
    ).toThrow(TrailTileError)
  })

  test("does not mutate provider input", () => {
    const input = structuredClone(hikingKct)
    const before = structuredClone(input)
    normalizeTrailTile(input, "hiking")
    expect(input).toEqual(before)
  })
})
