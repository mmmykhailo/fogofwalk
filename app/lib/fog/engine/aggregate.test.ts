import { describe, expect, test } from "bun:test"
import { bufferFogActivity } from "./buffer"
import { buildBoundedFog, emptyBoundedFog } from "./aggregate"
import { FOG_OUTPUT_DEFAULTS, validateFogRenderData } from "./validate"
import type { FogWorkerActivity } from "~/types/activities"

function activity(
  id: string,
  coordinates: [number, number][]
): FogWorkerActivity {
  return { id, name: id, coordinates }
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
