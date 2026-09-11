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
})
