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
    expect(report.errors).toContain(
      "feature 0 ring 0 self-intersection check exceeded its technical budget"
    )
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
    expect(report.errors).toContain("feature 0 ring 0 self-intersects")
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
