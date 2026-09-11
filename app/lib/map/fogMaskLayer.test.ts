import { describe, expect, test } from "bun:test"
import type { FogRenderData } from "~/lib/fog/protocol"
import { buildFogMaskVertices, createFogMaskLayer } from "./fogMaskLayer"

function square(west: number, south: number, east: number, north: number) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

describe("positive fog mask layer", () => {
  test("triangulates disconnected explored features independently", () => {
    const data: FogRenderData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: { type: "Polygon", coordinates: [square(10, 10, 11, 11)] },
        },
        {
          type: "Feature",
          properties: null,
          geometry: { type: "Polygon", coordinates: [square(30, 10, 31, 11)] },
        },
      ],
    }

    const vertices = buildFogMaskVertices(data)

    // Two triangles per square, replicated for the three wrapped worlds. The
    // returned triangles are used only for stencil writes, never visible fills.
    expect(vertices.length).toBe(2 * 3 * 2 * 3 * 2)
    expect(vertices.length % 6).toBe(0)
  })

  test("retains interior rings for earcut to exclude from the explored mask", () => {
    const data: FogRenderData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [square(10, 10, 20, 20), square(12, 12, 18, 18)],
          },
        },
      ],
    }

    const vertices = buildFogMaskVertices(data)
    expect(vertices.length).toBeGreaterThan(2 * 3 * 2 * 3)
  })

  test("exposes a MapLibre custom layer with mutable positive data", () => {
    const layer = createFogMaskLayer({
      type: "FeatureCollection",
      features: [],
    })

    expect(layer).toMatchObject({
      id: "fog-layer",
      type: "custom",
      renderingMode: "2d",
    })
    expect(typeof layer.setData).toBe("function")
    layer.setData({ type: "FeatureCollection", features: [] })
  })
})
