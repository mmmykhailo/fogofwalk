import earcut from "earcut"
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson"
import type maplibregl from "maplibre-gl"
import { FOG_COLOR, FOG_OPACITY } from "~/constants/fog"
import type { FogRenderData } from "~/lib/fog/protocol"

const MAX_RENDER_LATITUDE = 85.05112878
const WORLD_VERTICES = new Float32Array([
  -1, -1, 0, 0, 1, -1, 0, 0, 1, 1, 0, 0, -1, -1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0,
])
const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])
const VERTEX_STRIDE = 4 * Float32Array.BYTES_PER_ELEMENT
const LOW_ATTRIBUTE_OFFSET = 2 * Float32Array.BYTES_PER_ELEMENT
const FOG_RGBA: readonly [number, number, number, number] = (() => {
  const value = FOG_COLOR.replace("#", "")
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  return [
    red * FOG_OPACITY,
    green * FOG_OPACITY,
    blue * FOG_OPACITY,
    FOG_OPACITY,
  ]
})()

type PolygonGeometry = Polygon | MultiPolygon
type GL = WebGLRenderingContext | WebGL2RenderingContext

function writeProjectedCoordinate(
  longitude: number,
  latitude: number,
  output: Float64Array,
  offset: number
): void {
  const boundedLatitude = Math.max(
    -MAX_RENDER_LATITUDE,
    Math.min(MAX_RENDER_LATITUDE, latitude)
  )
  const radians = (boundedLatitude * Math.PI) / 180
  const sine = Math.sin(radians)
  output[offset] = (longitude + 180) / 360
  output[offset + 1] = 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
}

export function projectCoordinate(position: number[]): [number, number] {
  const output = new Float64Array(2)
  writeProjectedCoordinate(position[0]!, position[1]!, output, 0)
  return [output[0]!, output[1]!]
}

/** Split a JavaScript number into two float32 values whose sum preserves its detail. */
export function splitFloat64(value: number): [number, number] {
  const output = new Float32Array(2)
  writeSplitValue(value, output, 0, output, 1)
  return [output[0]!, output[1]!]
}

function writeSplitValue(
  value: number,
  highOutput: Float32Array,
  highOffset: number,
  lowOutput: Float32Array,
  lowOffset: number
): void {
  const high = Math.fround(value)
  highOutput[highOffset] = high
  lowOutput[lowOffset] = Math.fround(value - high)
}

/** Split a projected coordinate without allocating a per-coordinate array. */
function writeSplitCoordinate(
  x: number,
  y: number,
  output: Float32Array,
  offset: number
): void {
  writeSplitValue(x, output, offset, output, offset + 2)
  writeSplitValue(y, output, offset + 1, output, offset + 3)
}

export function splitCoordinate(
  x: number,
  y: number
): [number, number, number, number] {
  const output = new Float32Array(4)
  writeSplitCoordinate(x, y, output, 0)
  return [output[0]!, output[1]!, output[2]!, output[3]!]
}

/** Build M * T(anchor) while retaining the multiplication in JS number precision. */
export function buildCameraRelativeMatrix(
  matrix: ArrayLike<number>,
  anchorX: number,
  anchorY: number,
  output = new Float32Array(16)
): Float32Array {
  for (let index = 0; index < 16; index += 1) {
    output[index] = matrix[index]!
  }
  for (let row = 0; row < 4; row += 1) {
    output[12 + row] =
      matrix[row]! * anchorX + matrix[4 + row]! * anchorY + matrix[12 + row]!
  }
  return output
}

function ringPoints(ring: number[][]): [number, number][] {
  const points = ring
    .filter(
      (point) =>
        Array.isArray(point) &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    )
    .map((point) => projectCoordinate(point))
  if (points.length > 1) {
    const first = points[0]!
    const last = points.at(-1)!
    if (first[0] === last[0] && first[1] === last[1]) points.pop()
  }
  return points
}

function appendPolygon(coordinates: number[][][], output: number[]): boolean {
  const points: [number, number][] = []
  const holeIndices: number[] = []
  for (let index = 0; index < coordinates.length; index += 1) {
    const ring = ringPoints(coordinates[index]!)
    if (ring.length < 3) return false
    if (index > 0) holeIndices.push(points.length)
    points.push(...ring)
  }
  const flat = points.flatMap(([x, y]) => [x, y])
  let triangles: number[]
  try {
    triangles = earcut(flat, holeIndices, 2)
  } catch {
    return false
  }
  if (triangles.length === 0) return false
  for (const index of triangles) {
    const point = points[index]
    if (!point) return false
    output.push(point[0], point[1])
  }
  return true
}

function appendGeometry(geometry: PolygonGeometry, output: number[]): boolean {
  if (geometry.type === "Polygon") {
    return appendPolygon(geometry.coordinates, output)
  }
  let valid = true
  for (const coordinates of geometry.coordinates) {
    valid = appendPolygon(coordinates, output) && valid
  }
  return valid
}

function buildFogMaskCoordinates(data: FogRenderData): number[] {
  const base: number[] = []
  for (const feature of data.features) {
    if (!feature.geometry) continue
    appendGeometry(feature.geometry, base)
  }
  return base
}

/**
 * Triangulates only the positive explored masks and stores each coordinate as
 * a high/low float32 pair. The triangles are an internal stencil pass and are
 * never submitted as visible fill features, so shared edges cannot become
 * dark spokes or seams in the fog.
 */
export function buildFogMaskVertexData(data: FogRenderData): Float32Array {
  const coordinates = buildFogMaskCoordinates(data)
  const output = new Float32Array((coordinates.length / 2) * 3 * 4)
  let outputIndex = 0
  for (const worldOffset of [-1, 0, 1]) {
    for (let index = 0; index < coordinates.length; index += 2) {
      writeSplitCoordinate(
        coordinates[index]! + worldOffset,
        coordinates[index + 1]!,
        output,
        outputIndex
      )
      outputIndex += 4
    }
  }
  return output
}

function compileShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("Fog mask shader could not be created.")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown shader error"
    gl.deleteShader(shader)
    throw new Error(`Fog mask shader failed to compile: ${info}`)
  }
  return shader
}

function createProgram(gl: GL): WebGLProgram {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      precision highp float;
      attribute vec2 a_pos_high;
      attribute vec2 a_pos_low;
      uniform vec2 u_anchor_high;
      uniform vec2 u_anchor_low;
      uniform mat4 u_matrix;
      void main() {
        vec2 relative =
          (a_pos_high - u_anchor_high) + (a_pos_low - u_anchor_low);
        gl_Position = u_matrix * vec4(relative, 0.0, 1.0);
      }
    `
  )
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `
  )
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error("Fog mask shader program could not be created.")
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown program error"
    gl.deleteProgram(program)
    throw new Error(`Fog mask shader failed to link: ${info}`)
  }
  return program
}

function drawBuffer(
  gl: GL,
  buffer: WebGLBuffer,
  highAttribute: number,
  lowAttribute: number,
  vertexCount: number
): void {
  if (vertexCount === 0 || highAttribute < 0 || lowAttribute < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.vertexAttribPointer(highAttribute, 2, gl.FLOAT, false, VERTEX_STRIDE, 0)
  gl.vertexAttribPointer(
    lowAttribute,
    2,
    gl.FLOAT,
    false,
    VERTEX_STRIDE,
    LOW_ATTRIBUTE_OFFSET
  )
  gl.enableVertexAttribArray(highAttribute)
  gl.enableVertexAttribArray(lowAttribute)
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
  gl.disableVertexAttribArray(highAttribute)
  gl.disableVertexAttribArray(lowAttribute)
}

export interface FogMaskLayer extends maplibregl.CustomLayerInterface {
  setData(data: FogRenderData): void
}

/** Create the fog layer that masks one world-colored quad by explored space. */
export function createFogMaskLayer(initialData: FogRenderData): FogMaskLayer {
  let data = initialData
  let map: maplibregl.Map | null = null
  let glContext: GL | null = null
  let program: WebGLProgram | null = null
  let positiveBuffer: WebGLBuffer | null = null
  let worldBuffer: WebGLBuffer | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  let anchorHighLocation: WebGLUniformLocation | null = null
  let anchorLowLocation: WebGLUniformLocation | null = null
  let colorLocation: WebGLUniformLocation | null = null
  let positionHighLocation = -1
  let positionLowLocation = -1
  let positiveVertexCount = 0
  let contextLostHandler: (() => void) | null = null
  let contextRestoredHandler: (() => void) | null = null
  const cameraRelativeMatrix = new Float32Array(16)
  const anchorCoordinates = new Float64Array(2)
  const anchorHigh = new Float32Array(2)
  const anchorLow = new Float32Array(2)

  function discardResources(): void {
    // WebGL objects are invalid after context loss. Do not call delete* on the
    // lost context; MapLibre will provide a fresh context after restoration.
    program = null
    positiveBuffer = null
    worldBuffer = null
    matrixLocation = null
    anchorHighLocation = null
    anchorLowLocation = null
    colorLocation = null
    positionHighLocation = -1
    positionLowLocation = -1
    glContext = null
    positiveVertexCount = 0
  }

  function releaseResources(): void {
    if (glContext && program) glContext.deleteProgram(program)
    if (glContext && positiveBuffer) glContext.deleteBuffer(positiveBuffer)
    if (glContext && worldBuffer) glContext.deleteBuffer(worldBuffer)
    discardResources()
  }

  function createResources(nextGl: GL): void {
    const nextProgram = createProgram(nextGl)
    const nextPositiveBuffer = nextGl.createBuffer()
    const nextWorldBuffer = nextGl.createBuffer()
    if (!nextPositiveBuffer || !nextWorldBuffer) {
      nextGl.deleteProgram(nextProgram)
      if (nextPositiveBuffer) nextGl.deleteBuffer(nextPositiveBuffer)
      if (nextWorldBuffer) nextGl.deleteBuffer(nextWorldBuffer)
      throw new Error("Fog mask vertex buffers could not be created.")
    }

    const nextMatrixLocation = nextGl.getUniformLocation(
      nextProgram,
      "u_matrix"
    )
    const nextAnchorHighLocation = nextGl.getUniformLocation(
      nextProgram,
      "u_anchor_high"
    )
    const nextAnchorLowLocation = nextGl.getUniformLocation(
      nextProgram,
      "u_anchor_low"
    )
    const nextColorLocation = nextGl.getUniformLocation(nextProgram, "u_color")
    const nextPositionHighLocation = nextGl.getAttribLocation(
      nextProgram,
      "a_pos_high"
    )
    const nextPositionLowLocation = nextGl.getAttribLocation(
      nextProgram,
      "a_pos_low"
    )
    if (
      nextMatrixLocation === null ||
      nextAnchorHighLocation === null ||
      nextAnchorLowLocation === null ||
      nextColorLocation === null ||
      nextPositionHighLocation < 0 ||
      nextPositionLowLocation < 0
    ) {
      nextGl.deleteProgram(nextProgram)
      nextGl.deleteBuffer(nextPositiveBuffer)
      nextGl.deleteBuffer(nextWorldBuffer)
      throw new Error("Fog mask shader locations could not be resolved.")
    }

    program = nextProgram
    positiveBuffer = nextPositiveBuffer
    worldBuffer = nextWorldBuffer
    matrixLocation = nextMatrixLocation
    anchorHighLocation = nextAnchorHighLocation
    anchorLowLocation = nextAnchorLowLocation
    colorLocation = nextColorLocation
    positionHighLocation = nextPositionHighLocation
    positionLowLocation = nextPositionLowLocation
    glContext = nextGl
    nextGl.bindBuffer(nextGl.ARRAY_BUFFER, worldBuffer)
    nextGl.bufferData(nextGl.ARRAY_BUFFER, WORLD_VERTICES, nextGl.STATIC_DRAW)
    uploadPositiveData()
  }

  function ensureResources(nextGl: GL): void {
    if (
      glContext === nextGl &&
      program !== null &&
      positiveBuffer !== null &&
      worldBuffer !== null
    ) {
      return
    }
    if (glContext) releaseResources()
    createResources(nextGl)
  }

  function uploadPositiveData(): void {
    if (!glContext || !positiveBuffer) return
    const vertices = buildFogMaskVertexData(data)
    positiveVertexCount = vertices.length / 4
    glContext.bindBuffer(glContext.ARRAY_BUFFER, positiveBuffer)
    glContext.bufferData(
      glContext.ARRAY_BUFFER,
      vertices,
      glContext.STATIC_DRAW
    )
  }

  function updateCameraRelativeState(mainMatrix: ArrayLike<number>): void {
    const center = map?.getCenter()
    writeProjectedCoordinate(
      center?.lng ?? 0,
      center?.lat ?? 0,
      anchorCoordinates,
      0
    )
    writeSplitValue(anchorCoordinates[0]!, anchorHigh, 0, anchorLow, 0)
    writeSplitValue(anchorCoordinates[1]!, anchorHigh, 1, anchorLow, 1)
    buildCameraRelativeMatrix(
      mainMatrix,
      anchorCoordinates[0]!,
      anchorCoordinates[1]!,
      cameraRelativeMatrix
    )
  }

  function setData(next: FogRenderData): void {
    data = next
    uploadPositiveData()
    map?.triggerRepaint()
  }

  const layer: FogMaskLayer = {
    id: "fog-layer",
    type: "custom",
    renderingMode: "2d",
    setData,
    onAdd(nextMap, nextGl) {
      map = nextMap
      contextLostHandler = () => {
        if (map !== nextMap) return
        discardResources()
        // MapLibre does not call a custom layer's onRemove when it destroys a
        // style for context loss. Remove these listeners here so a discarded
        // implementation cannot retain the map after lifecycle rehydration.
        nextMap.off("webglcontextlost", contextLostHandler!)
        nextMap.off("webglcontextrestored", contextRestoredHandler!)
      }
      contextRestoredHandler = () => {
        if (map === nextMap) nextMap.triggerRepaint()
      }
      nextMap.on("webglcontextlost", contextLostHandler)
      nextMap.on("webglcontextrestored", contextRestoredHandler)
      ensureResources(nextGl)
    },
    render(nextGl, { defaultProjectionData }) {
      ensureResources(nextGl)
      if (
        !program ||
        !positiveBuffer ||
        !worldBuffer ||
        !matrixLocation ||
        !anchorHighLocation ||
        !anchorLowLocation ||
        !colorLocation ||
        positionHighLocation < 0 ||
        positionLowLocation < 0
      ) {
        return
      }

      nextGl.useProgram(program)
      updateCameraRelativeState(defaultProjectionData.mainMatrix)
      nextGl.disable(nextGl.BLEND)
      nextGl.disable(nextGl.DEPTH_TEST)
      nextGl.depthMask(false)
      nextGl.enable(nextGl.STENCIL_TEST)
      nextGl.stencilMask(0xff)

      // Reset the stencil over the world rectangle instead of clearing the
      // shared map stencil buffer, which could disturb later style layers.
      nextGl.uniformMatrix4fv(matrixLocation, false, IDENTITY_MATRIX)
      nextGl.uniform2f(anchorHighLocation, 0, 0)
      nextGl.uniform2f(anchorLowLocation, 0, 0)
      nextGl.colorMask(false, false, false, false)
      nextGl.stencilFunc(nextGl.ALWAYS, 0, 0xff)
      nextGl.stencilOp(nextGl.KEEP, nextGl.KEEP, nextGl.REPLACE)
      drawBuffer(
        nextGl,
        worldBuffer,
        positionHighLocation,
        positionLowLocation,
        WORLD_VERTICES.length / 4
      )

      nextGl.stencilFunc(nextGl.ALWAYS, 1, 0xff)
      nextGl.uniformMatrix4fv(matrixLocation, false, cameraRelativeMatrix)
      nextGl.uniform2f(anchorHighLocation, anchorHigh[0]!, anchorHigh[1]!)
      nextGl.uniform2f(anchorLowLocation, anchorLow[0]!, anchorLow[1]!)
      drawBuffer(
        nextGl,
        positiveBuffer,
        positionHighLocation,
        positionLowLocation,
        positiveVertexCount
      )

      nextGl.colorMask(true, true, true, true)
      nextGl.stencilFunc(nextGl.EQUAL, 0, 0xff)
      nextGl.stencilOp(nextGl.KEEP, nextGl.KEEP, nextGl.KEEP)
      nextGl.enable(nextGl.BLEND)
      nextGl.blendFunc(nextGl.ONE, nextGl.ONE_MINUS_SRC_ALPHA)
      nextGl.uniformMatrix4fv(matrixLocation, false, IDENTITY_MATRIX)
      nextGl.uniform2f(anchorHighLocation, 0, 0)
      nextGl.uniform2f(anchorLowLocation, 0, 0)
      nextGl.uniform4f(
        colorLocation,
        FOG_RGBA[0],
        FOG_RGBA[1],
        FOG_RGBA[2],
        FOG_RGBA[3]
      )
      drawBuffer(
        nextGl,
        worldBuffer,
        positionHighLocation,
        positionLowLocation,
        WORLD_VERTICES.length / 4
      )

      nextGl.disable(nextGl.STENCIL_TEST)
      nextGl.disable(nextGl.BLEND)
      nextGl.depthMask(true)
      nextGl.bindBuffer(nextGl.ARRAY_BUFFER, null)
      nextGl.useProgram(null)
    },
    onRemove(nextMap, nextGl) {
      if (contextLostHandler) {
        nextMap.off("webglcontextlost", contextLostHandler)
      }
      if (contextRestoredHandler) {
        nextMap.off("webglcontextrestored", contextRestoredHandler)
      }
      releaseResources()
      contextLostHandler = null
      contextRestoredHandler = null
      if (map === nextMap) map = null
    },
  }

  return layer
}

export type FogMaskFeatureCollection = FeatureCollection<PolygonGeometry>
