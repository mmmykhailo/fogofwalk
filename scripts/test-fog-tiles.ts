import assert from "node:assert/strict"
import difference from "@turf/difference"
import { featureCollection, polygon } from "@turf/helpers"
import { geoJSONToTile } from "@maplibre/geojson-vt"
import earcut from "earcut"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { bufferFogActivity, type FogMask } from "../app/lib/fog/engine/buffer"
import { buildBoundedFog } from "../app/lib/fog/engine/aggregate"
import type { FogWorkerActivity } from "../app/types/activities"

const WORLD_SOUTH = -85.05112878
const WORLD_NORTH = 85.05112878
const TILE_EXTENT = 4096
const RASTER_SIZE = 128
const TILE_OPTIONS = {
  extent: TILE_EXTENT,
  maxZoom: 14,
  buffer: 0,
  tolerance: 0,
  clip: true,
  wrap: false,
} as const

type Coordinate = [number, number]
type GeometryFeature = Feature<Polygon | MultiPolygon>
type GeometryCollection = FeatureCollection<Polygon | MultiPolygon>
type TileRing = Coordinate[]
type TilePolygon = TileRing[]
type Triangle = [Coordinate, Coordinate, Coordinate]

interface ReproducerOptions {
  pointCount: number
  amplitude: number
  frequency: number
  baseLatitude: number
  slope: number
  phase: number
  startLongitude: number
  longitudeLength: number
  pathSeparation: number
}

interface TileKey {
  z: number
  x: number
  y: number
}

interface TileRenderStats {
  tileFeatureCount: number
  triangleCount: number
  maxDeviation: number
  maxCoverage: number
  overdrawPixels: number
  coveredPixels: number
  coverage: Uint16Array
}

const REPRODUCER_OPTIONS: ReproducerOptions = {
  pointCount: 80,
  amplitude: 0.0244300335,
  frequency: 10.0293097,
  baseLatitude: 50.23327836,
  slope: 0.001658416,
  phase: 0.1224805,
  startLongitude: 14.5520311,
  longitudeLength: 0.37133559,
  pathSeparation: 0.00777737,
}

const REGRESSION_TILES: TileKey[] = [
  { z: 12, x: 2214, y: 1385 },
  { z: 13, x: 4428, y: 2770 },
  { z: 14, x: 8857, y: 5540 },
]

function makeReproducerActivity(
  offset: number,
  options: ReproducerOptions = REPRODUCER_OPTIONS
): FogWorkerActivity {
  const coordinates: Coordinate[] = Array.from(
    { length: options.pointCount },
    (_, index) => {
      const fraction = index / (options.pointCount - 1)
      return [
        options.startLongitude + options.longitudeLength * fraction,
        options.baseLatitude +
          offset +
          options.slope * (fraction - 0.5) +
          options.amplitude *
            Math.sin(
              options.frequency * fraction * 2 * Math.PI + options.phase
            ),
      ]
    }
  )
  return {
    id: `reproducer-${offset}`,
    name: "anonymized tile reproducer",
    coordinates,
    paths: [coordinates],
  }
}

function makeControlActivity(): FogWorkerActivity {
  const coordinates: Coordinate[] = Array.from({ length: 24 }, (_, index) => {
    const fraction = index / 23
    return [
      14.55 + 0.3 * fraction,
      50.225 + 0.002 * Math.sin(fraction * 4 * Math.PI),
    ]
  })
  return {
    id: "positive-mask-control",
    name: "positive mask control",
    coordinates,
    paths: [coordinates],
  }
}

function worldFeature(): Feature<Polygon> {
  return polygon([
    [
      [-180, WORLD_SOUTH],
      [180, WORLD_SOUTH],
      [180, WORLD_NORTH],
      [-180, WORLD_NORTH],
      [-180, WORLD_SOUTH],
    ],
  ])
}

function oldGlobalHole(masks: readonly FogMask[]): GeometryCollection {
  const result = difference(
    featureCollection([worldFeature(), ...masks])
  ) as GeometryFeature | null
  assert.ok(result, "the unsafe reference must produce a source feature")
  return featureCollection([result])
}

function withoutClosingPoint(ring: TileRing): TileRing {
  if (ring.length < 2) return ring
  const first = ring[0]!
  const last = ring[ring.length - 1]!
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1)
  }
  return ring
}

function tilePolygons(data: GeometryCollection, tile: TileKey): TilePolygon[] {
  const result = geoJSONToTile(data, tile.z, tile.x, tile.y, TILE_OPTIONS)
  return result.features.flatMap((feature) =>
    feature.type === 3 ? [feature.geometry as unknown as TilePolygon] : []
  )
}

function triangulateTilePolygon(rings: TilePolygon): Triangle[] {
  const points = rings.flatMap((ring) => withoutClosingPoint(ring))
  const flatPoints = points.flatMap(([x, y]) => [x, y])
  const holeIndices: number[] = []
  let pointOffset = withoutClosingPoint(rings[0] ?? []).length
  for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
    holeIndices.push(pointOffset)
    pointOffset += withoutClosingPoint(rings[ringIndex]!).length
  }
  const indices = earcut(flatPoints, holeIndices, 2)
  const triangles: Triangle[] = []
  for (let index = 0; index < indices.length; index += 3) {
    const first = points[indices[index]!]!
    const second = points[indices[index + 1]!]!
    const third = points[indices[index + 2]!]!
    if (first && second && third) triangles.push([first, second, third])
  }
  return triangles
}

function tilePolygonDeviation(rings: TilePolygon): number {
  const points = rings.flatMap((ring) => withoutClosingPoint(ring))
  if (points.length === 0) return 0
  const flatPoints = points.flatMap(([x, y]) => [x, y])
  const holeIndices: number[] = []
  let pointOffset = withoutClosingPoint(rings[0] ?? []).length
  for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
    holeIndices.push(pointOffset)
    pointOffset += withoutClosingPoint(rings[ringIndex]!).length
  }
  const indices = earcut(flatPoints, holeIndices, 2)
  const polygonArea = rings.reduce(
    (area, ring, ringIndex) =>
      area +
      (ringIndex === 0 ? 1 : -1) *
        Math.abs(signedArea(withoutClosingPoint(ring))),
    0
  )
  let trianglesArea = 0
  for (let index = 0; index < indices.length; index += 3) {
    const first = points[indices[index]!]!
    const second = points[indices[index + 1]!]!
    const third = points[indices[index + 2]!]!
    trianglesArea += Math.abs(cross(first, second, third)) / 2
  }
  return polygonArea === 0 && trianglesArea === 0
    ? 0
    : Math.abs((trianglesArea - polygonArea) / polygonArea)
}

function signedArea(ring: TileRing): number {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const first = ring[index]!
    const second = ring[(index + 1) % ring.length]!
    area += first[0] * second[1] - first[1] * second[0]
  }
  return area / 2
}

function cross(
  first: Coordinate,
  second: Coordinate,
  point: Coordinate
): number {
  return (
    (second[0] - first[0]) * (point[1] - first[1]) -
    (second[1] - first[1]) * (point[0] - first[0])
  )
}

function pointInTriangle(point: Coordinate, triangle: Triangle): boolean {
  const [first, second, third] = triangle
  const firstSide = cross(first, second, point)
  const secondSide = cross(second, third, point)
  const thirdSide = cross(third, first, point)
  return (
    (firstSide >= 0 && secondSide >= 0 && thirdSide >= 0) ||
    (firstSide <= 0 && secondSide <= 0 && thirdSide <= 0)
  )
}

function renderTile(data: GeometryCollection, tile: TileKey): TileRenderStats {
  const polygons = tilePolygons(data, tile)
  const triangles = polygons.flatMap(triangulateTilePolygon)
  const coverage = new Uint16Array(RASTER_SIZE * RASTER_SIZE)
  for (let row = 0; row < RASTER_SIZE; row += 1) {
    for (let column = 0; column < RASTER_SIZE; column += 1) {
      const point: Coordinate = [
        ((column + 0.5) * TILE_EXTENT) / RASTER_SIZE,
        ((row + 0.5) * TILE_EXTENT) / RASTER_SIZE,
      ]
      const index = row * RASTER_SIZE + column
      coverage[index] = triangles.reduce(
        (count, triangle) => count + (pointInTriangle(point, triangle) ? 1 : 0),
        0
      )
    }
  }
  return {
    tileFeatureCount: polygons.length,
    triangleCount: triangles.length,
    maxDeviation: polygons.reduce(
      (maximum, polygon) => Math.max(maximum, tilePolygonDeviation(polygon)),
      0
    ),
    maxCoverage: coverage.reduce(
      (maximum, count) => Math.max(maximum, count),
      0
    ),
    overdrawPixels: coverage.reduce(
      (count, pixels) => count + (pixels > 1 ? 1 : 0),
      0
    ),
    coveredPixels: coverage.reduce(
      (count, pixels) => count + (pixels > 0 ? 1 : 0),
      0
    ),
    coverage,
  }
}

function projectCoordinate(coordinate: Coordinate): Coordinate {
  const radians = (coordinate[1] * Math.PI) / 180
  const sine = Math.sin(radians)
  return [
    (coordinate[0] + 180) / 360,
    0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  ]
}

function tileForCoordinate(coordinate: Coordinate, zoom: number): TileKey {
  const scale = 2 ** zoom
  const [worldX, worldY] = projectCoordinate(coordinate)
  return {
    z: zoom,
    x: Math.floor(worldX * scale),
    y: Math.floor(worldY * scale),
  }
}

function localTileCoordinate(
  coordinate: Coordinate,
  tile: TileKey
): Coordinate {
  const scale = 2 ** tile.z
  const [worldX, worldY] = projectCoordinate(coordinate)
  return [
    (worldX * scale - tile.x) * TILE_EXTENT,
    (worldY * scale - tile.y) * TILE_EXTENT,
  ]
}

function assertPositiveRouteCrossesTiles(
  positive: GeometryCollection,
  activity: FogWorkerActivity
): void {
  const paths = activity.paths ?? [activity.coordinates]
  for (const zoom of [12, 13, 14]) {
    const seenTiles = new Set<string>()
    for (const path of paths) {
      for (let index = 0; index < path.length; index += 2) {
        const coordinate = path[index]!
        const tile = tileForCoordinate(coordinate, zoom)
        const triangles = tilePolygons(positive, tile).flatMap(
          triangulateTilePolygon
        )
        assert.ok(
          triangles.some((triangle) =>
            pointInTriangle(localTileCoordinate(coordinate, tile), triangle)
          ),
          `positive mask lost route sample at ${tile.z}/${tile.x}/${tile.y}`
        )
        seenTiles.add(`${tile.z}/${tile.x}/${tile.y}`)
      }
    }
    assert.ok(seenTiles.size > 1, `route did not cross tiles at z${zoom}`)
  }
}

function assertPositiveRepresentation(
  positive: GeometryCollection,
  safe: GeometryCollection,
  tile: TileKey
): void {
  const positiveStats = renderTile(positive, tile)
  const safeStats = renderTile(safe, tile)
  assert.equal(positiveStats.overdrawPixels, 0)
  assert.equal(safeStats.maxCoverage, 1)
  assert.equal(safeStats.overdrawPixels, 0)
  let mismatchedPixels = 0
  for (let index = 0; index < positiveStats.coverage.length; index += 1) {
    const positiveCovered = positiveStats.coverage[index]! > 0
    const safeCovered = safeStats.coverage[index]! > 0
    if (positiveCovered !== safeCovered) mismatchedPixels += 1
  }
  assert.ok(
    mismatchedPixels <= 64,
    `positive representations differ at ${tile.z}/${tile.x}/${tile.y} in ${mismatchedPixels} pixels`
  )
}

function main(): void {
  const activities = [
    makeReproducerActivity(-REPRODUCER_OPTIONS.pathSeparation / 2),
    makeReproducerActivity(REPRODUCER_OPTIONS.pathSeparation / 2),
  ]
  const masks = activities.flatMap(
    (activity) => bufferFogActivity(activity).masks
  )
  assert.equal(masks.length, 2)

  const unsafe = oldGlobalHole(masks)
  const safe = buildBoundedFog(masks, "corridor").fogData
  const controlActivity = makeControlActivity()
  const controlMask = bufferFogActivity(controlActivity).masks[0]
  assert.ok(controlMask)
  const positive = featureCollection([controlMask])
  const boundedControl = buildBoundedFog([controlMask], "corridor").fogData
  assertPositiveRouteCrossesTiles(positive, controlActivity)

  const report = REGRESSION_TILES.map((tile) => {
    const unsafeStats = renderTile(unsafe, tile)
    const safeStats = renderTile(safe, tile)
    // The two positive masks overlap in places; the production custom layer
    // writes a binary stencil, so triangle overlap here is expected and is not
    // a visible-opacity assertion.
    assert.ok(safeStats.maxCoverage >= 1)
    assertPositiveRepresentation(positive, boundedControl, tile)
    return {
      tile: `${tile.z}/${tile.x}/${tile.y}`,
      unsafe: {
        deviation: unsafeStats.maxDeviation,
        overdrawPixels: unsafeStats.overdrawPixels,
        maxCoverage: unsafeStats.maxCoverage,
      },
      positive: {
        deviation: safeStats.maxDeviation,
        overdrawPixels: safeStats.overdrawPixels,
        maxCoverage: safeStats.maxCoverage,
      },
    }
  })

  assert.ok(report[0]!.unsafe.deviation > 0.1)
  assert.ok(report[1]!.unsafe.deviation > 0.4)
  assert.equal(report[2]!.unsafe.deviation, 0)
  assert.ok(report[0]!.unsafe.overdrawPixels > 0)
  assert.ok(report[1]!.unsafe.overdrawPixels > 0)
  assert.equal(report[2]!.unsafe.overdrawPixels, 0)
  console.log(JSON.stringify({ fixture: REPRODUCER_OPTIONS, report }, null, 2))
}

main()
