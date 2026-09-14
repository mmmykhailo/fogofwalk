import { describe, expect, test } from "bun:test"
import {
  activitiesFeatureCollection,
  lapFeatureCollection,
  savedPointsFeatureCollection,
} from "~/lib/map/geojson"
import { savedPointMarkerImageId } from "~/lib/map/savedPointMarkerImages"

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

  test("[I-037] emits disconnected activity paths as one MultiLineString", () => {
    const result = activitiesFeatureCollection([
      {
        id: "activity-1",
        name: "Two segments",
        coordinates: [
          [14, 50],
          [14.01, 50.01],
          [15, 51],
          [15.01, 51.01],
        ],
        paths: [
          [
            [14, 50],
            [14.01, 50.01],
          ],
          [
            [15, 51],
            [15.01, 51.01],
          ],
        ],
      },
    ])

    expect(result.features[0]?.geometry.type).toBe("MultiLineString")
    expect(result.features[0]?.geometry.coordinates).toEqual([
      [
        [14, 50],
        [14.01, 50.01],
      ],
      [
        [15, 51],
        [15.01, 51.01],
      ],
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

  test("emits one marker feature with stable image and creation properties", () => {
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

    expect(result.features).toHaveLength(1)
    expect(result.features[0]?.properties).toEqual({
      id: "point-1",
      name: "Viewpoint",
      markerImage: savedPointMarkerImageId("blue"),
      stackOrder: 1,
    })
  })

  test("preserves source order while encoding creation priority", () => {
    const points = [
      {
        id: "newer",
        name: "Newer",
        description: null,
        color: "green" as const,
        lng: 14,
        lat: 50,
        isPublic: false,
        createdAt: 200,
        updatedAt: 200,
      },
      {
        id: "older",
        name: "Older",
        description: null,
        color: "red" as const,
        lng: 14.001,
        lat: 50.001,
        isPublic: false,
        createdAt: 100,
        updatedAt: 300,
      },
    ]
    const original = structuredClone(points)

    const result = savedPointsFeatureCollection(points)

    expect(result.features.map((feature) => feature.properties?.id)).toEqual([
      "newer",
      "older",
    ])
    expect(
      result.features.map((feature) => feature.properties?.stackOrder)
    ).toEqual([200, 100])
    expect(points).toEqual(original)
  })

  test("falls back to zero for malformed creation timestamps", () => {
    const result = savedPointsFeatureCollection([
      {
        id: "invalid",
        name: "Invalid timestamp",
        description: null,
        color: "blue",
        lng: 14,
        lat: 50,
        isPublic: false,
        createdAt: Number.NaN,
        updatedAt: 1,
      } as never,
    ])

    expect(result.features[0]?.properties?.stackOrder).toBe(0)
  })

  test("keeps the maximum saved-point source at one feature per point", () => {
    const points = Array.from({ length: 5_000 }, (_, index) => ({
      id: `point-${index}`,
      name: `Point ${index}`,
      description: null,
      color: "blue" as const,
      lng: 14,
      lat: 50,
      isPublic: false,
      createdAt: index,
      updatedAt: index,
    }))

    expect(savedPointsFeatureCollection(points).features).toHaveLength(5_000)
  })
})
