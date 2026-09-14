import { describe, expect, test } from "bun:test"
import type maplibregl from "maplibre-gl"
import type { FogRenderData } from "~/lib/fog/protocol"
import {
  buildCameraRelativeMatrix,
  buildFogMaskVertexData,
  createFogMaskLayer,
  projectCoordinate,
  splitCoordinate,
  splitFloat64,
} from "./fogMaskLayer"

function square(west: number, south: number, east: number, north: number) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

function reconstructVertex(data: Float32Array, vertexIndex: number) {
  const offset = vertexIndex * 4
  return [
    data[offset]! + data[offset + 2]!,
    data[offset + 1]! + data[offset + 3]!,
  ] as const
}

type FakeGlState = {
  bufferData: Array<{ data: unknown; usage: number }>
  drawCalls: Array<{ mode: number; first: number; count: number }>
  matrixUniforms: number[][]
  anchorUniforms: Array<[number, number]>
  vertexPointers: Array<{
    index: number
    size: number
    stride: number
    offset: number
  }>
}

function createFakeGl(lookups = { uniforms: 0, attributes: 0 }) {
  const state: FakeGlState = {
    bufferData: [],
    drawCalls: [],
    matrixUniforms: [],
    anchorUniforms: [],
    vertexPointers: [],
  }
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
    bufferData: (_target: number, data: unknown, usage: number) => {
      state.bufferData.push({ data, usage })
    },
    getUniformLocation: () => {
      lookups.uniforms++
      return {} as WebGLUniformLocation
    },
    getAttribLocation: () => {
      const location = lookups.attributes
      lookups.attributes += 1
      return location
    },
    useProgram: () => {},
    uniformMatrix4fv: (
      _location: WebGLUniformLocation,
      _transpose: boolean,
      value: ArrayLike<number>
    ) => {
      state.matrixUniforms.push(Array.from(value))
    },
    uniform2f: (_location: WebGLUniformLocation, x: number, y: number) => {
      state.anchorUniforms.push([x, y])
    },
    disable: () => {},
    depthMask: () => {},
    enable: () => {},
    stencilMask: () => {},
    colorMask: () => {},
    stencilFunc: () => {},
    stencilOp: () => {},
    uniform4f: () => {},
    vertexAttribPointer: (
      index: number,
      size: number,
      _type: number,
      _normalized: boolean,
      stride: number,
      offset: number
    ) => {
      state.vertexPointers.push({ index, size, stride, offset })
    },
    enableVertexAttribArray: () => {},
    drawArrays: (mode: number, first: number, count: number) => {
      state.drawCalls.push({ mode, first, count })
    },
    disableVertexAttribArray: () => {},
    blendFunc: () => {},
  } as unknown as WebGLRenderingContext
  return { gl, state }
}

function createFakeMap() {
  const handlers = new Map<string, () => void>()
  let center = { lng: 13.5, lat: 52.5 }
  const map = {
    getCenter: () => center,
    on(event: string, handler: () => void) {
      handlers.set(event, handler)
    },
    off(event: string) {
      handlers.delete(event)
    },
    triggerRepaint() {},
  } as unknown as maplibregl.Map
  return {
    map,
    handlers,
    setCenter(nextCenter: { lng: number; lat: number }) {
      center = nextCenter
    },
  }
}

function identityMatrix() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

describe("positive fog mask layer", () => {
  test("reconstructs projected coordinates from high and low float32 parts", () => {
    const coordinates = [
      projectCoordinate([13.4, 52.5]),
      projectCoordinate([0, 0]),
      projectCoordinate([-180, 85.05112878]),
      projectCoordinate([180, -85.05112878]),
      projectCoordinate([179.999, 12]),
      projectCoordinate([-180.001, -12]),
    ]

    for (const [x, y] of coordinates) {
      const [xHigh, yHigh, xLow, yLow] = splitCoordinate(x, y)
      expect(Math.abs(xHigh + xLow - x)).toBeLessThan(1e-12)
      expect(Math.abs(yHigh + yLow - y)).toBeLessThan(1e-12)
    }

    const [high, low] = splitFloat64(coordinates[0]![0])
    expect(high + low).toBeCloseTo(coordinates[0]![0], 12)
  })

  test("keeps an anchored high-zoom transform equivalent to a direct transform", () => {
    const [anchorX, anchorY] = projectCoordinate([13.5, 52.5])
    const point = [anchorX + 1e-9, anchorY - 2e-9]
    const matrix = new Float64Array([
      280_000,
      0.25,
      0,
      0,
      0.5,
      -280_000,
      0,
      0,
      0,
      0,
      1,
      0,
      -(280_000 * anchorX + 0.5 * anchorY),
      -(0.25 * anchorX - 280_000 * anchorY),
      0,
      1,
    ])
    const anchored = buildCameraRelativeMatrix(matrix, anchorX, anchorY)
    const [pointHighX, pointHighY, pointLowX, pointLowY] = splitCoordinate(
      point[0],
      point[1]
    )
    const [anchorHighX, anchorHighY, anchorLowX, anchorLowY] = splitCoordinate(
      anchorX,
      anchorY
    )
    const relative = [
      pointHighX - anchorHighX + (pointLowX - anchorLowX),
      pointHighY - anchorHighY + (pointLowY - anchorLowY),
    ]
    const transform = (source: ArrayLike<number>, x: number, y: number) => [
      source[0]! * x + source[4]! * y + source[12]!,
      source[1]! * x + source[5]! * y + source[13]!,
    ]

    const direct = transform(matrix, point[0], point[1])
    const reconstructed = transform(anchored, relative[0]!, relative[1]!)
    expect(Math.abs(reconstructed[0]! - direct[0]!)).toBeLessThan(0.002)
    expect(Math.abs(reconstructed[1]! - direct[1]!)).toBeLessThan(0.002)
  })

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

    const vertices = buildFogMaskVertexData(data)

    // Two triangles per square, replicated for the three wrapped worlds. The
    // returned triangles are used only for stencil writes, never visible fills.
    expect(vertices.length / 4).toBe(2 * 3 * 2 * 3)
    expect(vertices.length % 12).toBe(0)

    const firstWorld = reconstructVertex(vertices, 0)
    const secondWorld = reconstructVertex(vertices, 12)
    const thirdWorld = reconstructVertex(vertices, 24)
    expect(secondWorld[0] - firstWorld[0]).toBeCloseTo(1, 12)
    expect(thirdWorld[0] - secondWorld[0]).toBeCloseTo(1, 12)
    expect(secondWorld[1]).toBeCloseTo(firstWorld[1], 12)
    expect(thirdWorld[1]).toBeCloseTo(firstWorld[1], 12)
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

    const vertices = buildFogMaskVertexData(data)
    expect(vertices.length / 4).toBeGreaterThan(2 * 3 * 3)
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
    const firstGl = createFakeGl(lookups)
    const fakeMap = createFakeMap()
    const layer = createFogMaskLayer({
      type: "FeatureCollection",
      features: [],
    })
    const renderArgs = {
      defaultProjectionData: { mainMatrix: identityMatrix() },
    } as never

    layer.onAdd?.(fakeMap.map, firstGl.gl)
    layer.render?.(firstGl.gl, renderArgs)
    layer.render?.(firstGl.gl, renderArgs)
    layer.render?.(firstGl.gl, renderArgs)
    expect(lookups).toEqual({ uniforms: 4, attributes: 2 })

    layer.onRemove?.(fakeMap.map, firstGl.gl)
    layer.onAdd?.(fakeMap.map, firstGl.gl)
    layer.render?.(firstGl.gl, renderArgs)
    expect(lookups).toEqual({ uniforms: 8, attributes: 4 })

    fakeMap.handlers.get("webglcontextlost")?.()
    const restoredGl = createFakeGl(lookups)
    layer.onAdd?.(fakeMap.map, restoredGl.gl)
    layer.render?.(restoredGl.gl, renderArgs)
    expect(lookups).toEqual({ uniforms: 12, attributes: 6 })
  })

  test("does not upload geometry while the camera changes", () => {
    const fakeGl = createFakeGl()
    const fakeMap = createFakeMap()
    const matrix = identityMatrix()
    const renderArgs = {
      defaultProjectionData: { mainMatrix: matrix },
    } as never
    const layer = createFogMaskLayer({
      type: "FeatureCollection",
      features: [],
    })

    layer.onAdd?.(fakeMap.map, fakeGl.gl)
    layer.render?.(fakeGl.gl, renderArgs)
    const uploadCount = fakeGl.state.bufferData.length

    fakeMap.setCenter({ lng: 181, lat: 40 })
    matrix[12] = 0.25
    matrix[13] = -0.75
    layer.render?.(fakeGl.gl, renderArgs)
    fakeMap.setCenter({ lng: -181, lat: -40 })
    matrix[12] = -0.25
    matrix[13] = 0.75
    layer.render?.(fakeGl.gl, renderArgs)

    expect(fakeGl.state.bufferData).toHaveLength(uploadCount)
    expect(fakeGl.state.matrixUniforms).toHaveLength(9)

    layer.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: { type: "Polygon", coordinates: [square(10, 10, 11, 11)] },
        },
      ],
    })
    expect(fakeGl.state.bufferData).toHaveLength(uploadCount + 1)
  })

  test("uses a clip-space world quad for both world passes", () => {
    const fakeGl = createFakeGl()
    const fakeMap = createFakeMap()
    const layer = createFogMaskLayer({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: { type: "Polygon", coordinates: [square(10, 10, 11, 11)] },
        },
      ],
    })
    const renderArgs = {
      defaultProjectionData: { mainMatrix: identityMatrix() },
    } as never

    layer.onAdd?.(fakeMap.map, fakeGl.gl)
    const worldData = fakeGl.state.bufferData[0]!.data as Float32Array
    const expectedWorld: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ]
    expect(worldData.length).toBe(6 * 4)
    for (let index = 0; index < expectedWorld.length; index += 1) {
      expect(reconstructVertex(worldData, index)).toEqual(expectedWorld[index])
    }

    layer.render?.(fakeGl.gl, renderArgs)
    expect(fakeGl.state.drawCalls).toEqual([
      { mode: 8, first: 0, count: 6 },
      { mode: 8, first: 0, count: 18 },
      { mode: 8, first: 0, count: 6 },
    ])
    expect(fakeGl.state.matrixUniforms[0]).toEqual(Array.from(identityMatrix()))
    expect(fakeGl.state.matrixUniforms[2]).toEqual(Array.from(identityMatrix()))
    expect(fakeGl.state.vertexPointers).toEqual([
      { index: 0, size: 2, stride: 16, offset: 0 },
      { index: 1, size: 2, stride: 16, offset: 8 },
      { index: 0, size: 2, stride: 16, offset: 0 },
      { index: 1, size: 2, stride: 16, offset: 8 },
      { index: 0, size: 2, stride: 16, offset: 0 },
      { index: 1, size: 2, stride: 16, offset: 8 },
    ])
  })
})
