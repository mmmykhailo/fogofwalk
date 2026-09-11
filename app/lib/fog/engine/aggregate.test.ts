import { describe, expect, test } from "bun:test"
import { bufferFogActivity } from "./buffer"
import { buildBoundedFog, emptyBoundedFog } from "./aggregate"
import { validateFogRenderData } from "./validate"
import type { FogWorkerActivity } from "~/types/activities"

function activity(
  id: string,
  coordinates: [number, number][]
): FogWorkerActivity {
  return { id, name: id, coordinates }
}

describe("bounded fog aggregation", () => {
  test("represents an empty world as bounded hole-free partitions", () => {
    const result = emptyBoundedFog()

    expect(result.degraded).toBe(false)
    expect(result.partitionCount).toBe(72)
    expect(result.fogData.features.length).toBe(72)
    expect(validateFogRenderData(result.fogData).ok).toBe(true)
    expect(
      result.fogData.features.every(
        (feature) =>
          feature.geometry.type === "Polygon" &&
          feature.geometry.coordinates.length === 1
      )
    ).toBe(true)
  })

  test("triangulates inverse route holes before publication", () => {
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
    for (const feature of result.fogData.features) {
      expect(feature.geometry.type).toBe("Polygon")
      if (feature.geometry.type === "Polygon") {
        expect(feature.geometry.coordinates).toHaveLength(1)
      }
    }
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
    // Filling the loop removes the small interior fog island, so the inverse
    // is represented by fewer triangles than corridor mode.
    expect(fill.featureCount).toBeLessThan(corridor.featureCount)
  })

  test("keeps crossing routes and loops inside bounded partitions", () => {
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
      corridor.fogData.features.every(
        (feature) =>
          feature.geometry.type === "Polygon" &&
          feature.geometry.coordinates.length === 1
      )
    ).toBe(true)
    expect(
      fill.fogData.features.every(
        (feature) =>
          feature.geometry.type === "Polygon" &&
          feature.geometry.coordinates.length === 1
      )
    ).toBe(true)
    expect(fill.featureCount).toBeLessThan(corridor.featureCount)
  })
})
