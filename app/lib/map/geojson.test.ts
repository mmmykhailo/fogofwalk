import { describe, expect, test } from "bun:test"
import {
  activitiesFeatureCollection,
  lapFeatureCollection,
  savedPointsFeatureCollection,
} from "~/lib/map/geojson"

describe("map GeoJSON builders", () => {
  test("builds activity features with stable selection properties", () => {
    const result = activitiesFeatureCollection([
      {
        id: "activity-1",
        name: "Morning ride",
        coordinates: [
          [14, 50],
          [15, 51],
        ],
      },
    ])

    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties).toEqual({
      id: "activity-1",
      name: "Morning ride",
    })
    expect(result.features[0].geometry.coordinates).toEqual([
      [14, 50],
      [15, 51],
    ])
  })

  test("omits an invalid lap and emits a usable lap", () => {
    expect(lapFeatureCollection([[14, 50]]).features).toEqual([])
    expect(
      lapFeatureCollection([
        [14, 50],
        [15, 51],
      ]).features
    ).toHaveLength(1)
  })

  test("resolves saved-point palette colors", () => {
    const result = savedPointsFeatureCollection([
      {
        id: "point-1",
        name: "Viewpoint",
        description: null,
        color: "blue",
        lng: 14,
        lat: 50,
        isPublic: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(result.features[0].properties).toEqual({
      id: "point-1",
      name: "Viewpoint",
      color: "#2563eb",
    })
  })
})
