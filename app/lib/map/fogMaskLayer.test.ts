import { describe, expect, test } from "bun:test"
import type maplibregl from "maplibre-gl"
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

  test("resolves shader handles once per resource set", () => {
    const lookups = { uniforms: 0, attributes: 0 }
    const gl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      ARRAY_BUFFER: 5,
      STATIC_DRAW: 6,
      FLOAT: 7,
      TRIANGLES: 8,
      BLEND: 9,
      DEPTH_TEST: 10,
      STENCIL_TEST: 11,
      ALWAYS: 12,
      EQUAL: 13,
      KEEP: 14,
      REPLACE: 15,
      ONE: 16,
      ONE_MINUS_SRC_ALPHA: 17,
      createShader: () => ({}) as WebGLShader,
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => null,
      deleteShader: () => {},
      createProgram: () => ({}) as WebGLProgram,
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      getProgramInfoLog: () => null,
      deleteProgram: () => {},
      createBuffer: () => ({}) as WebGLBuffer,
      deleteBuffer: () => {},
      bindBuffer: () => {},
      bufferData: () => {},
      getUniformLocation: () => {
        lookups.uniforms++
        return {} as WebGLUniformLocation
      },
      getAttribLocation: () => {
        lookups.attributes++
        return 0
      },
      useProgram: () => {},
      uniformMatrix4fv: () => {},
      disable: () => {},
      depthMask: () => {},
      enable: () => {},
      stencilMask: () => {},
      colorMask: () => {},
      stencilFunc: () => {},
      stencilOp: () => {},
      uniform4f: () => {},
      vertexAttribPointer: () => {},
      enableVertexAttribArray: () => {},
      drawArrays: () => {},
      disableVertexAttribArray: () => {},
      blendFunc: () => {},
    } as unknown as WebGLRenderingContext
    const handlers = new Map<string, () => void>()
    const map = {
      on(event: string, handler: () => void) {
        handlers.set(event, handler)
      },
      off(event: string) {
        handlers.delete(event)
      },
      triggerRepaint() {},
    } as unknown as maplibregl.Map
    const layer = createFogMaskLayer({
      type: "FeatureCollection",
      features: [],
    })
    const renderArgs = {
      defaultProjectionData: { mainMatrix: new Float32Array(16) },
    } as never

    layer.onAdd?.(map, gl)
    layer.render?.(gl, renderArgs)
    layer.render?.(gl, renderArgs)
    layer.render?.(gl, renderArgs)
    expect(lookups).toEqual({ uniforms: 2, attributes: 1 })

    layer.onRemove?.(map, gl)
    layer.onAdd?.(map, gl)
    layer.render?.(gl, renderArgs)
    expect(lookups).toEqual({ uniforms: 4, attributes: 2 })
  })
})
