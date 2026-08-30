import { describe, expect, test } from "bun:test"
import type union from "@turf/union"
import {
  createActivityFogBuffer,
  mergeFogMasks,
  stripInnerRings,
  subtractFogMasks,
  validFogCoordinates,
  worldFogFeature,
} from "./fogGeometry"

describe("fog geometry", () => {
  test("buffers legitimate coordinates around null island", () => {
    const fogBuffer = createActivityFogBuffer([
      [0, 0],
      [0.002, 0.002],
    ])

    expect(fogBuffer).not.toBeNull()
  })

  test("filters non-finite and out-of-range coordinates", () => {
    expect(
      validFogCoordinates([
        [14, 50],
        [Number.NaN, 50],
        [14, 91],
        [181, 50],
        [14.01, 50.01],
      ])
    ).toEqual([
      [14, 50],
      [14.01, 50.01],
    ])

    expect(createActivityFogBuffer([[14, 50]])).toBeNull()
  })

  test("subtracts every corridor in a batch", () => {
    const first = createActivityFogBuffer([
      [14, 50],
      [14.01, 50.01],
    ])!
    const second = createActivityFogBuffer([
      [15, 50],
      [15.01, 50.01],
    ])!

    const fog = subtractFogMasks(worldFogFeature(), [first, second])

    expect(fog.geometry.type).toBe("Polygon")
    if (fog.geometry.type === "Polygon") {
      // World exterior plus one cleared ring per disjoint route.
      expect(fog.geometry.coordinates).toHaveLength(3)
    }
  })

  test("keeps both masks when Turf cannot union them", () => {
    const first = createActivityFogBuffer([
      [14, 50],
      [14.01, 50.01],
    ])!
    const second = createActivityFogBuffer([
      [15, 50],
      [15.01, 50.01],
    ])!
    const failingUnion = (() => {
      throw new Error("numerical failure")
    }) as typeof union

    const merged = mergeFogMasks(first, second, failingUnion)
    expect(merged.geometry.type).toBe("MultiPolygon")
    if (merged.geometry.type === "MultiPolygon") {
      expect(merged.geometry.coordinates).toHaveLength(2)
    }

    const fog = subtractFogMasks(worldFogFeature(), [merged])
    expect(fog.geometry.type).toBe("Polygon")
    if (fog.geometry.type === "Polygon") {
      expect(fog.geometry.coordinates).toHaveLength(3)
    }
  })

  test("fill mode removes the unexplored island inside a closed route", () => {
    const loop = createActivityFogBuffer([
      [14, 50],
      [14.02, 50],
      [14.02, 50.02],
      [14, 50.02],
      [14, 50],
    ])!

    expect(loop.geometry.type).toBe("Polygon")
    if (loop.geometry.type === "Polygon") {
      expect(loop.geometry.coordinates).toHaveLength(2)
    }

    const corridorFog = subtractFogMasks(worldFogFeature(), [loop])
    const fillFog = subtractFogMasks(worldFogFeature(), [stripInnerRings(loop)])

    // Corridor mode leaves the loop interior as a separate fog polygon; fill
    // mode clears it and leaves only the world polygon with one outer hole.
    expect(corridorFog.geometry.type).toBe("MultiPolygon")
    expect(fillFog.geometry.type).toBe("Polygon")
  })
})
