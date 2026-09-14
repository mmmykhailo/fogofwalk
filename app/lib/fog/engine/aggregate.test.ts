import { describe, expect, test } from "bun:test"
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson"
import { bufferFogActivity } from "./buffer"
import {
  appendFogMasks,
  buildBoundedFog,
  createFogMaskAccumulator,
  emptyBoundedFog,
  finalizeFogMaskAccumulator,
} from "./aggregate"
import { FOG_OUTPUT_DEFAULTS, validateFogRenderData } from "./validate"
import type { FogWorkerActivity } from "~/types/activities"

const overlappingFillCoordinates = {
  first: [
    [14.000236923331627, 50.002461053277834],
    [13.999885548084043, 50.00128527134704],
  ] as [number, number][],
  second: [
    [14.001899999203859, 49.99982727904059],
    [14.00195723735355, 50.00086659489153],
  ] as [number, number][],
}

const invalidProjectedRing: [number, number][] = [
  [0.5, 0.5],
  [0.5001, 0.5001],
  [0.5, 0.5001],
  [0.5001, 0.5],
  [0.5, 0.5],
]

const invalidProjectedFeature: Feature<Polygon> = {
  type: "Feature",
  properties: null,
  geometry: { type: "Polygon", coordinates: [invalidProjectedRing] },
}

type FillUnionOperationForTest = NonNullable<
  Parameters<typeof appendFogMasks>[2]
>

function activity(
  id: string,
  coordinates: [number, number][]
): FogWorkerActivity {
  return { id, name: id, coordinates }
}

function pointInRing(
  [longitude, latitude]: [number, number],
  ring: number[][]
): boolean {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    index++
  ) {
    const currentLongitude = ring[index]![0]!
    const currentLatitude = ring[index]![1]!
    const previousLongitude = ring[previous]![0]!
    const previousLatitude = ring[previous]![1]!
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude
    if (
      crossesLatitude &&
      longitude <
        ((previousLongitude - currentLongitude) *
          (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude
    ) {
      inside = !inside
    }
    previous = index
  }
  return inside
}

function featureCoversPoint(
  feature: Feature<Polygon | MultiPolygon>,
  point: [number, number]
): boolean {
  if (feature.geometry.type !== "Polygon") return false
  return pointInRing(point, feature.geometry.coordinates[0]!)
}

function invalidProjectedUnion<P extends GeoJsonProperties = GeoJsonProperties>(
  _features: FeatureCollection<Polygon | MultiPolygon>
): Feature<Polygon, P> {
  return invalidProjectedFeature as Feature<Polygon, P>
}

describe("bounded fog aggregation", () => {
  test("bounds the quadratic ring self-intersection check", () => {
    const report = validateFogRenderData(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: null,
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [3, 0],
                  [4, 2],
                  [2, 4],
                  [0, 2],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      },
      { maxIntersectionChecks: 0 }
    )

    expect(Number.isFinite(FOG_OUTPUT_DEFAULTS.maxIntersectionChecks)).toBe(
      true
    )
    expect(report.ok).toBe(false)
    expect(report.status).toBe("budget_exceeded")
    expect(report.errors).toContain(
      "feature 0 ring 0 self-intersection check exceeded its technical budget"
    )
  })

  test("reports output size limits as technical budget exhaustion", () => {
    const report = validateFogRenderData(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: null,
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      },
      { maxFeatures: 0 }
    )

    expect(report.ok).toBe(false)
    expect(report.status).toBe("budget_exceeded")
    expect(report.errorCodes.feature_budget_exceeded).toBe(1)
  })

  test("preserves the self-intersection error when the check completes", () => {
    const report = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [3, 3],
                [0, 3],
                [3, 0],
                [0, 0],
              ],
            ],
          },
        },
      ],
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe("invalid")
    expect(report.errors).toContain("feature 0 ring 0 self-intersects")
  })

  test("validates large simple rings with the spatially indexed scan", () => {
    const pointCount = 5_000
    const ring = Array.from({ length: pointCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / (pointCount - 1)
      return [Math.cos(angle), Math.sin(angle)] as [number, number]
    })
    ring[ring.length - 1] = ring[0]!
    const report = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      ],
    })

    expect(report.status).toBe("valid")
    expect(report.ok).toBe(true)
  })

  test("rejects repeated vertices and holes touching their shell", () => {
    const repeated = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [2, 0],
                [0, 0],
              ],
            ],
          },
        },
      ],
    })
    expect(repeated.status).toBe("invalid")
    expect(repeated.errorCodes.repeated_vertex).toBeGreaterThan(0)

    const touchingHole = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
              [
                [0, 2],
                [3, 2],
                [3, 4],
                [0, 4],
                [0, 2],
              ],
            ],
          },
        },
      ],
    })
    expect(touchingHole.status).toBe("invalid")
    expect(touchingHole.errorCodes.hole_touches_shell).toBeGreaterThan(0)
  })

  test("rejects collinear overlaps and near-epsilon non-adjacent crossings", () => {
    const collinearOverlap = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [4, 0],
                [1, 0],
                [1, 3],
                [0, 3],
                [0, 0],
              ],
            ],
          },
        },
      ],
    })
    expect(collinearOverlap.status).toBe("invalid")
    expect(collinearOverlap.errorCodes.ring_self_intersects).toBeGreaterThan(0)

    const nearEpsilonCrossing = validateFogRenderData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [4, 4],
                [0, 4],
                [4, 4 - 1e-13],
                [0, 0],
              ],
            ],
          },
        },
      ],
    })
    expect(nearEpsilonCrossing.status).toBe("invalid")
    expect(nearEpsilonCrossing.errorCodes.ring_self_intersects).toBeGreaterThan(
      0
    )
  })

  test("reports cancellation separately from invalid geometry", () => {
    const pointCount = 5_000
    const ring = Array.from({ length: pointCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / (pointCount - 1)
      return [Math.cos(angle), Math.sin(angle)] as [number, number]
    })
    ring[ring.length - 1] = ring[0]!
    let checkpoints = 0
    const report = validateFogRenderData(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: null,
            geometry: { type: "Polygon", coordinates: [ring] },
          },
        ],
      },
      {
        shouldCancel: () => {
          checkpoints += 1
          return checkpoints > 4
        },
      }
    )

    expect(report.ok).toBe(false)
    expect(report.status).toBe("cancelled")
    expect(report.errorCodes.validation_cancelled).toBeGreaterThan(0)
  })

  test("rejects an oversized partition grid before constructing it", () => {
    expect(() =>
      emptyBoundedFog({
        longitudeSpanDegrees: 0.000001,
        latitudeSpanDegrees: 0.000001,
        maxPartitions: 10,
      })
    ).toThrow("Fog partition scheme exceeds its technical partition budget.")
  })

  test("represents an empty world as an empty positive mask", () => {
    const result = emptyBoundedFog()

    expect(result.degraded).toBe(false)
    expect(result.partitionCount).toBe(0)
    expect(result.fogData.features.length).toBe(0)
    expect(validateFogRenderData(result.fogData).ok).toBe(true)
  })

  test("publishes positive route masks without inverse triangulation", () => {
    const buffered = bufferFogActivity(
      activity("route", [
        [14, 50],
        [14.1, 50],
        [14.1, 50.1],
        [14, 50.1],
        [14, 50],
      ])
    )
    expect(buffered.rejected).toBe(false)

    const result = buildBoundedFog(buffered.masks, "corridor")
    const report = validateFogRenderData(result.fogData)
    expect(report.ok).toBe(true)
    expect(result.degraded).toBe(false)
    expect(result.fogData.features.length).toBeGreaterThan(0)
    expect(result.fogData.features[0]?.geometry.type).toBe("Polygon")
    const rawVertexCount = buffered.masks.reduce((total, mask) => {
      if (mask.geometry.type === "Polygon") {
        return (
          total +
          mask.geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0)
        )
      }
      return (
        total +
        mask.geometry.coordinates.reduce(
          (sum, polygonCoordinates) =>
            sum +
            polygonCoordinates.reduce(
              (polygonSum, ring) => polygonSum + ring.length,
              0
            ),
          0
        )
      )
    }, 0)
    expect(result.vertexCount).toBeLessThan(rawVertexCount)
  })

  test("omits only an invalid explored feature", () => {
    const invalid = {
      type: "Feature" as const,
      properties: null,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [2, 2],
            [0, 2],
            [2, 0],
            [0, 0],
          ],
        ],
      },
    }
    const valid = {
      type: "Feature" as const,
      properties: null,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [30, 0],
            [31, 0],
            [31, 1],
            [30, 1],
            [30, 0],
          ],
        ],
      },
    }
    const result = buildBoundedFog([invalid, valid], "corridor")

    expect(result.degraded).toBe(true)
    expect(result.geometryFallbackCount).toBe(1)
    expect(result.fogData.features).toHaveLength(1)
    expect(result.fogData.features[0]?.geometry.type).toBe("Polygon")
    if (result.fogData.features[0]?.geometry.type === "Polygon") {
      expect(result.fogData.features[0].geometry.coordinates[0]?.[0]).toEqual([
        30, 0,
      ])
    }
    expect(validateFogRenderData(result.fogData).ok).toBe(true)
  })

  test("fills a closed loop only when fill mode requests it", () => {
    const buffered = bufferFogActivity(
      activity("loop", [
        [14, 50],
        [14.02, 50],
        [14.02, 50.02],
        [14, 50.02],
        [14, 50],
      ])
    )
    expect(buffered.rejected).toBe(false)

    const corridor = buildBoundedFog(buffered.masks, "corridor")
    const fill = buildBoundedFog(buffered.masks, "fill")
    expect(validateFogRenderData(corridor.fogData).ok).toBe(true)
    expect(validateFogRenderData(fill.fogData).ok).toBe(true)
    // Filling the loop removes the unvisited interior ring from the positive
    // explored mask; the custom layer handles any remaining holes.
    const corridorGeometry = corridor.fogData.features[0]?.geometry
    const fillGeometry = fill.fogData.features[0]?.geometry
    expect(corridorGeometry?.type).toBe("Polygon")
    expect(fillGeometry?.type).toBe("Polygon")
    if (
      corridorGeometry?.type === "Polygon" &&
      fillGeometry?.type === "Polygon"
    ) {
      expect(corridorGeometry.coordinates.length).toBeGreaterThan(
        fillGeometry.coordinates.length
      )
    }
  })

  test("keeps disjoint fill components out of one global union", () => {
    const first = bufferFogActivity(
      activity("first", [
        [0, 0],
        [0.01, 0],
      ])
    )
    const second = bufferFogActivity(
      activity("second", [
        [30, 0],
        [30.01, 0],
      ])
    )
    expect(first.rejected).toBe(false)
    expect(second.rejected).toBe(false)

    const result = buildBoundedFog([...first.masks, ...second.masks], "fill")

    expect(result.degraded).toBe(false)
    expect(result.fogData.features).toHaveLength(2)
  })

  test("merges valid overlapping fill masks after validating in geographic coordinates", () => {
    const first = bufferFogActivity(
      activity("overlapping-first", overlappingFillCoordinates.first)
    )
    const second = bufferFogActivity(
      activity("overlapping-second", overlappingFillCoordinates.second)
    )
    expect(first.rejected).toBe(false)
    expect(first.masks).toHaveLength(1)
    expect(second.rejected).toBe(false)
    expect(second.masks).toHaveLength(1)

    const result = buildBoundedFog([...first.masks, ...second.masks], "fill")

    expect(result.degraded).toBe(false)
    expect(result.warningCounts).toEqual({})
    expect(result.coverageReducedCounts).toEqual({})
    expect(result.warnings).not.toContain(
      "explored-mask union failed; affected masks remain as separate explored regions"
    )
    expect(result.geometryFallbackCount).toBe(0)
    expect(result.featureCount).toBe(1)
    expect(result.fogData.features).toHaveLength(1)
    const feature = result.fogData.features[0]
    expect(feature?.geometry.type).toBe("Polygon")
    if (feature?.geometry.type === "Polygon") {
      expect(feature.geometry.coordinates[0]?.length).toBeGreaterThan(0)
    }
    expect(validateFogRenderData(result.fogData).ok).toBe(true)
  })

  test("retains all masks and stops retrying after a failed fill union", () => {
    const first = bufferFogActivity(
      activity("fallback-first", overlappingFillCoordinates.first)
    )
    const second = bufferFogActivity(
      activity("fallback-second", overlappingFillCoordinates.second)
    )
    const third = bufferFogActivity(
      activity("fallback-third", [
        [14.002, 50],
        [14.003, 50],
      ])
    )
    expect(first.rejected).toBe(false)
    expect(first.masks).toHaveLength(1)
    expect(second.rejected).toBe(false)
    expect(second.masks).toHaveLength(1)
    expect(third.rejected).toBe(false)
    expect(third.masks).toHaveLength(1)

    const failureCases: {
      name: string
      operation: FillUnionOperationForTest
    }[] = [
      {
        name: "throws",
        operation: () => {
          throw new Error("injected union failure")
        },
      },
      { name: "returns null", operation: () => null },
      {
        name: "returns invalid geometry",
        operation: invalidProjectedUnion,
      },
    ]

    for (const { name, operation } of failureCases) {
      const accumulator = createFogMaskAccumulator("fill")
      appendFogMasks(accumulator, first.masks)
      appendFogMasks(accumulator, second.masks, operation)

      expect(accumulator.degraded, name).toBe(true)
      expect(accumulator.projectedMasks, name).toHaveLength(2)
      expect(accumulator.fillComponents, name).toHaveLength(0)
      expect(accumulator.fillComponentsByPartition.size, name).toBe(0)
      expect(accumulator.dirtyPartitions.size, name).toBe(0)

      const result = finalizeFogMaskAccumulator(accumulator)
      expect(result.fogData.features, name).toHaveLength(2)
      expect(validateFogRenderData(result.fogData).ok, name).toBe(true)
      expect(result.warningCounts, name).toEqual({
        "explored-mask-union-failed": 1,
      })
      expect(result.coverageReducedCounts, name).toEqual({
        "explored-mask-union-failed": 1,
      })
      expect(result.warnings, name).toEqual([
        "explored-mask union failed; affected masks remain as separate explored regions",
      ])
      expect(result.geometryFallbackCount, name).toBe(0)

      let retryCount = 0
      const spyUnion: FillUnionOperationForTest = () => {
        retryCount += 1
        return null
      }
      appendFogMasks(accumulator, third.masks, spyUnion)
      expect(retryCount, name).toBe(0)
      expect(accumulator.projectedMasks, name).toHaveLength(3)
    }
  })

  test("does not call the injected union operation for corridor or disjoint fill appends", () => {
    const corridorFirst = bufferFogActivity(
      activity("seam-corridor-first", [
        [0, 0],
        [0.01, 0],
      ])
    )
    const corridorSecond = bufferFogActivity(
      activity("seam-corridor-second", [
        [0.005, 0],
        [0.015, 0],
      ])
    )
    const disjoint = bufferFogActivity(
      activity("seam-disjoint", [
        [30, 0],
        [30.01, 0],
      ])
    )
    expect(corridorFirst.rejected).toBe(false)
    expect(corridorSecond.rejected).toBe(false)
    expect(disjoint.rejected).toBe(false)

    let callCount = 0
    const injectedUnion: FillUnionOperationForTest = () => {
      callCount += 1
      return null
    }
    const corridor = createFogMaskAccumulator("corridor")
    appendFogMasks(corridor, corridorFirst.masks, injectedUnion)
    appendFogMasks(corridor, corridorSecond.masks, injectedUnion)

    const fill = createFogMaskAccumulator("fill")
    appendFogMasks(fill, corridorFirst.masks, injectedUnion)
    appendFogMasks(fill, disjoint.masks, injectedUnion)

    expect(callCount).toBe(0)
    expect(corridor.projectedMasks).toHaveLength(2)
    expect(fill.projectedMasks).toHaveLength(2)
  })

  test("fills a loop completed by multiple activities", () => {
    const firstHalf: [number, number][] = [
      [14, 50],
      [14.01, 50],
      [14.01, 50.01],
    ]
    const secondHalf: [number, number][] = [
      [14.01, 50.01],
      [14, 50.01],
      [14, 50],
    ]
    const loopCenter: [number, number] = [14.005, 50.005]
    const first = bufferFogActivity(activity("first-half", firstHalf))
    const second = bufferFogActivity(activity("second-half", secondHalf))
    expect(first.rejected).toBe(false)
    expect(first.masks).toHaveLength(1)
    expect(second.rejected).toBe(false)
    expect(second.masks).toHaveLength(1)

    const masks = [...first.masks, ...second.masks]
    const corridor = buildBoundedFog(masks, "corridor")
    const fill = buildBoundedFog(masks, "fill")

    expect(corridor.fogData.features).toHaveLength(2)
    expect(
      corridor.fogData.features.some(
        (feature) =>
          feature.geometry.type === "Polygon" &&
          featureCoversPoint(feature, loopCenter)
      )
    ).toBe(false)
    expect(fill.degraded).toBe(false)
    expect(fill.warningCounts).toEqual({})
    expect(fill.coverageReducedCounts).toEqual({})
    expect(fill.fogData.features).toHaveLength(1)
    const fillFeature = fill.fogData.features[0]
    expect(fillFeature?.geometry.type).toBe("Polygon")
    if (fillFeature?.geometry.type === "Polygon") {
      expect(fillFeature.geometry.coordinates).toHaveLength(1)
      expect(featureCoversPoint(fillFeature, loopCenter)).toBe(true)
    }
    expect(validateFogRenderData(fill.fogData).ok).toBe(true)
  })

  test("keeps crossing routes and loops as positive explored geometry", () => {
    const crossingRoute = bufferFogActivity(
      activity("crossing-route", [
        ...Array.from(
          { length: 96 },
          (_, index) =>
            [-30.4 + (60.8 * index) / 95, 20 + Math.sin(index / 8) * 0.2] as [
              number,
              number,
            ]
        ),
      ])
    )
    const crossingLoop = bufferFogActivity(
      activity("crossing-loop", [
        [29.4, 20],
        [30.6, 20],
        [30.6, 21.2],
        [29.4, 21.2],
        [29.4, 20],
      ])
    )
    expect(crossingRoute.rejected).toBe(false)
    expect(crossingLoop.rejected).toBe(false)

    const masks = [...crossingRoute.masks, ...crossingLoop.masks]
    const corridor = buildBoundedFog(masks, "corridor")
    const fill = buildBoundedFog(masks, "fill")
    expect(corridor.degraded).toBe(false)
    expect(fill.degraded).toBe(false)
    expect(validateFogRenderData(corridor.fogData).ok).toBe(true)
    expect(validateFogRenderData(fill.fogData).ok).toBe(true)
    expect(
      fill.fogData.features.every(
        (feature) =>
          feature.geometry.type === "Polygon" ||
          feature.geometry.type === "MultiPolygon"
      )
    ).toBe(true)
    expect(fill.featureCount).toBeLessThan(corridor.featureCount)
  })
})
