import earcut from "earcut"
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson"
import type maplibregl from "maplibre-gl"
import { FOG_COLOR, FOG_OPACITY } from "~/constants/fog"
import type { FogRenderData } from "~/lib/fog/protocol"

const MAX_RENDER_LATITUDE = 85.05112878
const WORLD_VERTICES = new Float32Array([-1, 0, 2, 0, 2, 1, -1, 0, 2, 1, -1, 1])

type PolygonGeometry = Polygon | MultiPolygon
type GL = WebGLRenderingContext | WebGL2RenderingContext

function projectCoordinate(position: number[]): [number, number] {
  const longitude = position[0]!
  const latitude = Math.max(
    -MAX_RENDER_LATITUDE,
    Math.min(MAX_RENDER_LATITUDE, position[1]!)
  )
  const radians = (latitude * Math.PI) / 180
  const sine = Math.sin(radians)
  return [
    (longitude + 180) / 360,
    0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  ]
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

/**
 * Triangulates only the positive explored masks. The triangles are an internal
 * stencil pass and are never submitted as visible fill features, so shared
 * edges cannot become dark spokes or seams in the fog.
 */
export function buildFogMaskVertices(data: FogRenderData): Float32Array {
  const base: number[] = []
  for (const feature of data.features) {
    if (!feature.geometry) continue
    appendGeometry(feature.geometry, base)
  }
  const wrapped: number[] = []
  for (const offset of [-1, 0, 1]) {
    for (let index = 0; index < base.length; index += 2) {
      wrapped.push(base[index]! + offset, base[index + 1]!)
    }
  }
  return new Float32Array(wrapped)
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
      attribute vec2 a_pos;
      uniform mat4 u_matrix;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
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

function fogColor(): [number, number, number, number] {
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
}

function drawBuffer(
  gl: GL,
  buffer: WebGLBuffer,
  attribute: number,
  vertexCount: number
): void {
  if (vertexCount === 0 || attribute < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(attribute)
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
  gl.disableVertexAttribArray(attribute)
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
  let positiveVertexCount = 0

  function uploadPositiveData(): void {
    if (!glContext || !positiveBuffer) return
    const vertices = buildFogMaskVertices(data)
    positiveVertexCount = vertices.length / 2
    glContext.bindBuffer(glContext.ARRAY_BUFFER, positiveBuffer)
    glContext.bufferData(
      glContext.ARRAY_BUFFER,
      vertices,
      glContext.STATIC_DRAW
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
      glContext = nextGl
      program = createProgram(nextGl)
      positiveBuffer = nextGl.createBuffer()
      worldBuffer = nextGl.createBuffer()
      if (!positiveBuffer || !worldBuffer) {
        throw new Error("Fog mask vertex buffers could not be created.")
      }
      nextGl.bindBuffer(nextGl.ARRAY_BUFFER, worldBuffer)
      nextGl.bufferData(nextGl.ARRAY_BUFFER, WORLD_VERTICES, nextGl.STATIC_DRAW)
      uploadPositiveData()
    },
    render(nextGl, { modelViewProjectionMatrix }) {
      if (!program || !positiveBuffer || !worldBuffer) return
      const matrix = nextGl.getUniformLocation(program, "u_matrix")
      const color = nextGl.getUniformLocation(program, "u_color")
      const position = nextGl.getAttribLocation(program, "a_pos")
      if (!matrix || !color || position < 0) return

      nextGl.useProgram(program)
      nextGl.uniformMatrix4fv(matrix, false, modelViewProjectionMatrix)
      nextGl.disable(nextGl.BLEND)
      nextGl.disable(nextGl.DEPTH_TEST)
      nextGl.depthMask(false)
      nextGl.enable(nextGl.STENCIL_TEST)
      nextGl.stencilMask(0xff)

      // Reset the stencil over the world rectangle instead of clearing the
      // shared map stencil buffer, which could disturb later style layers.
      nextGl.colorMask(false, false, false, false)
      nextGl.stencilFunc(nextGl.ALWAYS, 0, 0xff)
      nextGl.stencilOp(nextGl.KEEP, nextGl.KEEP, nextGl.REPLACE)
      drawBuffer(nextGl, worldBuffer, position, WORLD_VERTICES.length / 2)

      nextGl.stencilFunc(nextGl.ALWAYS, 1, 0xff)
      drawBuffer(nextGl, positiveBuffer, position, positiveVertexCount)

      nextGl.colorMask(true, true, true, true)
      nextGl.stencilFunc(nextGl.EQUAL, 0, 0xff)
      nextGl.stencilOp(nextGl.KEEP, nextGl.KEEP, nextGl.KEEP)
      nextGl.enable(nextGl.BLEND)
      nextGl.blendFunc(nextGl.ONE, nextGl.ONE_MINUS_SRC_ALPHA)
      const [red, green, blue, alpha] = fogColor()
      nextGl.uniform4f(color, red, green, blue, alpha)
      drawBuffer(nextGl, worldBuffer, position, WORLD_VERTICES.length / 2)

      nextGl.disable(nextGl.STENCIL_TEST)
      nextGl.disable(nextGl.BLEND)
      nextGl.depthMask(true)
      nextGl.bindBuffer(nextGl.ARRAY_BUFFER, null)
      nextGl.useProgram(null)
    },
    onRemove(nextMap, nextGl) {
      if (program) nextGl.deleteProgram(program)
      if (positiveBuffer) nextGl.deleteBuffer(positiveBuffer)
      if (worldBuffer) nextGl.deleteBuffer(worldBuffer)
      program = null
      positiveBuffer = null
      worldBuffer = null
      glContext = null
      if (map === nextMap) map = null
    },
  }

  return layer
}

export type FogMaskFeatureCollection = FeatureCollection<PolygonGeometry>
