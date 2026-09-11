import { performance } from "node:perf_hooks"
import bbox from "@turf/bbox"
import difference from "@turf/difference"
import { featureCollection, polygon } from "@turf/helpers"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { bufferFogActivity, type FogMask } from "../app/lib/fog/engine/buffer"
import { buildBoundedFog } from "../app/lib/fog/engine/aggregate"
import { validateFogRenderData } from "../app/lib/fog/engine/validate"
import type { FogWorkerActivity } from "../app/types/activities"

const WORLD_SOUTH = -85.05112878
const WORLD_NORTH = 85.05112878
const ITERATIONS = 3
const SCALE_TIERS = [100, 1_000, 10_000]

type GeometryFeature = Feature<Polygon | MultiPolygon>
type GeometryCollection = FeatureCollection<Polygon | MultiPolygon>

function makeFixture(): FogWorkerActivity[] {
  return Array.from({ length: 24 }, (_, index) => {
    if (index === 0) {
      return {
        id: `route-${index}`,
        name: "synthetic route",
        coordinates: Array.from(
          { length: 96 },
          (_, point) =>
            [-31 + (62 * point) / 95, 12 + Math.sin(point / 7) * 0.8] as [
              number,
              number,
            ]
        ),
      }
    }

    const centreLongitude = -12 + (index % 8) * 6
    const centreLatitude = 34 + Math.floor(index / 8) * 5
    if (index % 6 === 0) {
      return {
        id: `route-${index}`,
        name: "synthetic loop",
        coordinates: Array.from({ length: 96 }, (_, point) => {
          const angle = (Math.PI * 2 * point) / 95
          return [
            centreLongitude + Math.cos(angle) * 0.7,
            centreLatitude + Math.sin(angle) * 0.7,
          ] as [number, number]
        }),
      }
    }

    return {
      id: `route-${index}`,
      name: "synthetic route",
      coordinates: Array.from(
        { length: 96 },
        (_, point) =>
          [
            centreLongitude + (point / 95 - 0.5) * 1.4,
            centreLatitude + Math.sin(point / 8 + index) * 0.25,
          ] as [number, number]
      ),
    }
  })
}

function collectMasks(activities: readonly FogWorkerActivity[]): FogMask[] {
  return activities.flatMap((activity) => bufferFogActivity(activity).masks)
}

function countCoordinates(geometry: unknown): number {
  if (!Array.isArray(geometry)) return 0
  if (geometry.length === 0) return 0
  if (typeof geometry[0] === "number") return 1
  return geometry.reduce((count, child) => count + countCoordinates(child), 0)
}

function geometryMetrics(data: GeometryCollection) {
  const ringCount = data.features.reduce((count, feature) => {
    const coordinates = feature.geometry.coordinates
    if (feature.geometry.type === "Polygon") return count + coordinates.length
    return (
      count +
      coordinates.reduce(
        (rings, polygonCoordinates) => rings + polygonCoordinates.length,
        0
      )
    )
  }, 0)
  const vertexCount = data.features.reduce(
    (count, feature) => count + countCoordinates(feature.geometry.coordinates),
    0
  )
  const byteLength = new TextEncoder().encode(JSON.stringify(data)).byteLength
  const bounds = data.features.length > 0 ? bbox(data) : null
  return {
    featureCount: data.features.length,
    ringCount,
    vertexCount,
    byteLength,
    bounds,
    validForPositiveSource: validateFogRenderData(data, {
      allowInteriorRings: true,
    }).ok,
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

function globalHole(masks: readonly FogMask[]): GeometryCollection {
  const result = difference(
    featureCollection([worldFeature(), ...masks])
  ) as GeometryFeature | null
  return result
    ? featureCollection([result])
    : featureCollection<Polygon | MultiPolygon>([])
}

function makeScaleMasks(count: number): FogMask[] {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cellWidth = 340 / columns
    const cellHeight = 160 / rows
    const longitude = -170 + (column + 0.5) * cellWidth
    const latitude = -80 + (row + 0.5) * cellHeight
    const width = cellWidth * 0.15
    const height = cellHeight * 0.15
    return polygon([
      [
        [longitude - width / 2, latitude - height / 2],
        [longitude + width / 2, latitude - height / 2],
        [longitude + width / 2, latitude + height / 2],
        [longitude - width / 2, latitude + height / 2],
        [longitude - width / 2, latitude - height / 2],
      ],
    ]) as FogMask
  })
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second)
  return sorted[Math.floor(sorted.length / 2)]!
}

function percentile(
  values: readonly number[],
  percentileValue: number
): number {
  const sorted = [...values].sort((first, second) => first - second)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  )
  return sorted[index]!
}

function benchmark(
  name: string,
  build: () => GeometryCollection,
  iterations = ITERATIONS
): {
  name: string
  medianMs: number
  p95Ms: number
  heapUsedMb: number
  metrics: ReturnType<typeof geometryMetrics>
} {
  const durations: number[] = []
  const heapSamples: number[] = []
  let output: GeometryCollection | null = null
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now()
    output = build()
    durations.push(performance.now() - started)
    heapSamples.push(process.memoryUsage().heapUsed)
  }
  return {
    name,
    medianMs: Number(median(durations).toFixed(2)),
    p95Ms: Number((percentile(durations, 0.95) ?? 0).toFixed(2)),
    heapUsedMb: Number((Math.max(...heapSamples) / (1024 * 1024)).toFixed(2)),
    metrics: geometryMetrics(output!),
  }
}

function benchmarkScale(count: number) {
  const masks = makeScaleMasks(count)
  let degraded = false
  let warningCount = 0
  const iterations = count >= 10_000 ? 1 : ITERATIONS
  const safe = benchmark(
    "positive-mask-aggregated",
    () => {
      const result = buildBoundedFog(masks, "corridor")
      degraded = result.degraded
      warningCount = result.warnings.length
      return result.fogData
    },
    iterations
  )
  return {
    corpus: {
      activityCount: count,
      maskCount: masks.length,
      pointsPerMask: 5,
    },
    positive: {
      ...safe,
      degraded,
      warningCount,
    },
  }
}

const masks = collectMasks(makeFixture())
const positive = featureCollection(masks) as GeometryCollection
const bounded = () => {
  const result = buildBoundedFog(masks, "corridor")
  return result.fogData
}

const baseline = {
  fixture: { activityCount: 24, masks: masks.length, pointsPerRoute: 96 },
  candidates: [
    benchmark("positive-explored-mask", () => positive),
    benchmark("positive-mask-aggregated", bounded),
    benchmark("global-hole-reference", () => globalHole(masks)),
  ],
}

console.log(
  JSON.stringify(
    {
      baseline,
      scaleTiers: SCALE_TIERS.map(benchmarkScale),
    },
    null,
    2
  )
)
