import { performance } from "node:perf_hooks"
import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import bbox from "@turf/bbox"
import difference from "@turf/difference"
import { featureCollection, polygon } from "@turf/helpers"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { FOG_EMIT_INTERVAL_MS } from "../app/constants/fog"
import { bufferFogActivity, type FogMask } from "../app/lib/fog/engine/buffer"
import {
  buildBoundedFog,
  simplifyFogForEmission,
} from "../app/lib/fog/engine/aggregate"
import { createFogEngine, type FogEngineResult } from "../app/lib/fog/engine"
import { sanitizeFogInput } from "../app/lib/fog/engine/input"
import { validateFogRenderData } from "../app/lib/fog/engine/validate"
import { FOG_PROTOCOL_VERSION, type FogRequest } from "../app/lib/fog/protocol"
import type { FogWorkerActivity } from "../app/types/activities"

const WORLD_SOUTH = -85.05112878
const WORLD_NORTH = 85.05112878
const ITERATIONS = 3
const REAL_FIXTURE_ACTIVITY_COUNT = 500
const SCALE_TIERS = [100, 1_000, 10_000]
const REAL_DATASET_SOURCE =
  "https://www.kaggle.com/datasets/roccoli/gpx-hike-tracks"

type GeometryFeature = Feature<Polygon | MultiPolygon>
type GeometryCollection = FeatureCollection<Polygon | MultiPolygon>

async function* readCsvRows(path: string): AsyncGenerator<string[]> {
  const stream = createReadStream(path, { encoding: "utf8" })
  let field = ""
  let record: string[] = []
  let inQuotes = false
  let pendingQuote = false

  try {
    for await (const chunk of stream) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!

        if (inQuotes) {
          if (pendingQuote) {
            pendingQuote = false
            if (character === '"') {
              field += '"'
              continue
            }
            inQuotes = false
          }

          if (inQuotes) {
            if (character === '"') pendingQuote = true
            else field += character
            continue
          }
        }

        if (character === '"') {
          inQuotes = true
        } else if (character === ",") {
          record.push(field)
          field = ""
        } else if (character === "\n") {
          record.push(field)
          field = ""
          if (record.some((value) => value.length > 0)) yield record
          record = []
        } else if (character !== "\r") {
          field += character
        }
      }
    }

    if (pendingQuote) {
      pendingQuote = false
      inQuotes = false
    }
    if (field.length > 0 || record.length > 0) {
      record.push(field)
      yield record
    }
  } finally {
    stream.destroy()
  }
}

function parseHikrTrackPaths(xml: string): [number, number][][] {
  const segments = [
    ...xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi),
  ].map((match) => match[1] ?? "")
  const sourceSegments = segments.length > 0 ? segments : [xml]
  const paths: [number, number][][] = []

  for (const segment of sourceSegments) {
    const path: [number, number][] = []
    for (const match of segment.matchAll(/<trkpt\b([^>]*)>/gi)) {
      const attributes = match[1] ?? ""
      const latitude = Number(
        attributes.match(/\blat\s*=\s*["']([^"']+)["']/i)?.[1]
      )
      const longitude = Number(
        attributes.match(/\blon\s*=\s*["']([^"']+)["']/i)?.[1]
      )
      if (
        Number.isFinite(latitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        Number.isFinite(longitude)
      ) {
        path.push([longitude, latitude])
      }
    }
    if (path.length >= 2) paths.push(path)
  }

  return paths
}

interface RealFixture {
  activities: FogWorkerActivity[]
  sourceRowsScanned: number
  skippedRecords: number
}

async function loadRealFixture(): Promise<RealFixture> {
  const datasetPath = process.env.FOG_BENCHMARK_CSV
  if (!datasetPath) {
    throw new Error(
      "Set FOG_BENCHMARK_CSV to the extracted gpx-tracks-from-hikr.org.csv file. " +
        "See docs/performance-update.md for the source and download command."
    )
  }

  const rows = readCsvRows(datasetPath)
  const header = await rows.next()
  if (header.done || !header.value) {
    throw new Error(`real activity dataset is empty: ${datasetPath}`)
  }

  const columns = new Map(header.value.map((name, index) => [name, index]))
  const gpxColumn = columns.get("gpx")
  if (gpxColumn === undefined) {
    throw new Error(`real activity dataset has no gpx column: ${datasetPath}`)
  }
  const idColumn = columns.get("_id")
  const nameColumn = columns.get("name")
  const activities: FogWorkerActivity[] = []
  let sourceRowsScanned = 0
  let skippedRecords = 0

  for await (const row of rows) {
    sourceRowsScanned += 1
    const paths = parseHikrTrackPaths(row[gpxColumn] ?? "")
    if (paths.length === 0) {
      skippedRecords += 1
      continue
    }

    const coordinates = paths.flatMap((path) => path)
    activities.push({
      id: row[idColumn ?? -1] || `hikr-activity-${sourceRowsScanned}`,
      name: row[nameColumn ?? -1] || "recorded hike",
      coordinates,
      paths,
    })
    if (activities.length >= REAL_FIXTURE_ACTIVITY_COUNT) break
  }

  if (activities.length < REAL_FIXTURE_ACTIVITY_COUNT) {
    throw new Error(
      `real activity dataset contained only ${activities.length} usable activities; ` +
        `expected ${REAL_FIXTURE_ACTIVITY_COUNT}`
    )
  }

  return { activities, sourceRowsScanned, skippedRecords }
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

function makeScaleActivities(count: number): FogWorkerActivity[] {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const cellWidth = 340 / columns
  const cellHeight = 156 / rows
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const longitude = -170 + (column + 0.5) * cellWidth
    const latitude = -78 + (row + 0.5) * cellHeight
    // Keep every synthetic segment below the input teleport threshold even in
    // the equatorial 100-activity tier, so a partial result measures geometry
    // pressure rather than an accidentally rejected corpus.
    const halfLength = cellWidth * 0.004
    return {
      id: `engine-route-${index}`,
      name: "synthetic engine route",
      coordinates: [
        [longitude - halfLength, latitude],
        [longitude + halfLength, latitude],
      ],
    }
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

function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce(
    (total, count) => total + Math.max(0, Math.floor(count)),
    0
  )
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

function safeBenchmark(
  name: string,
  build: () => GeometryCollection
):
  | ReturnType<typeof benchmark>
  | { name: string; status: "failed"; error: string } {
  try {
    return benchmark(name, build)
  } catch (error) {
    return {
      name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }
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
      warningCount = sumCounts(result.warningCounts)
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

function parsePublicSample(xml: string): FogWorkerActivity {
  const coordinates: [number, number][] = []
  for (const match of xml.matchAll(/<trkpt\b([^>]*)>/g)) {
    const attributes = match[1] ?? ""
    const latitude = Number(attributes.match(/\blat="([^"]+)"/)?.[1])
    const longitude = Number(attributes.match(/\blon="([^"]+)"/)?.[1])
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      coordinates.push([longitude, latitude])
    }
  }
  if (coordinates.length === 0) {
    throw new Error("public sample GPX did not contain track points")
  }
  return {
    id: "public-sample-run",
    name: "public sample run",
    coordinates,
  }
}

function roundedMilliseconds(value: number): number {
  return Number(value.toFixed(2))
}

async function benchmarkPublicSample() {
  const xml = await readFile(
    new URL("../public/sample-run.gpx", import.meta.url),
    "utf8"
  )
  const activity = parsePublicSample(xml)

  const sanitizeStarted = performance.now()
  const sanitized = sanitizeFogInput(activity)
  const sanitizeMs = roundedMilliseconds(performance.now() - sanitizeStarted)
  if (sanitized.rejected) {
    throw new Error(`public sample sanitizer rejected: ${sanitized.reason}`)
  }

  const bufferStarted = performance.now()
  const buffered = bufferFogActivity(activity)
  const bufferMs = roundedMilliseconds(performance.now() - bufferStarted)
  if (buffered.rejected || buffered.masks.length === 0) {
    throw new Error(`public sample buffer rejected: ${buffered.reason}`)
  }

  const rawMasks = featureCollection(buffered.masks) as GeometryCollection
  const emissionStarted = performance.now()
  const emittedMasks = buffered.masks.map((mask) =>
    simplifyFogForEmission(mask as GeometryFeature)
  )
  const emissionMs = roundedMilliseconds(performance.now() - emissionStarted)
  const emittedMasksData = featureCollection(emittedMasks) as GeometryCollection
  const rawValidationStarted = performance.now()
  const rawValidation = validateFogRenderData(rawMasks, {
    allowInteriorRings: true,
  })
  const rawValidationMs = roundedMilliseconds(
    performance.now() - rawValidationStarted
  )
  const emittedValidationStarted = performance.now()
  const emittedValidation = validateFogRenderData(emittedMasksData, {
    allowInteriorRings: true,
  })
  const emittedValidationMs = roundedMilliseconds(
    performance.now() - emittedValidationStarted
  )

  async function benchmarkMode(mode: "corridor" | "fill") {
    const aggregateStarted = performance.now()
    const aggregate = buildBoundedFog(buffered.masks, mode)
    const aggregateMs = roundedMilliseconds(
      performance.now() - aggregateStarted
    )

    const engine = createFogEngine({
      emitIntervalMs: Number.MAX_SAFE_INTEGER,
      hooks: {
        yieldToScheduler: () => Promise.resolve(),
      },
    })
    const engineStarted = performance.now()
    const result = await engine.process({
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: `public-sample-${mode}`,
      generation: mode === "corridor" ? 1 : 2,
      libraryRevision: 1,
      coverageRevision: 1,
      mode,
      kind: "rebuild",
      activities: [activity],
    })
    const engineMs = roundedMilliseconds(performance.now() - engineStarted)
    const snapshot =
      result.status === "complete" || result.status === "partial"
        ? result.snapshot
        : null
    if (!snapshot) throw new Error(`public sample engine failed in ${mode}`)
    const snapshotValidation = validateFogRenderData(snapshot.geometry, {
      allowInteriorRings: true,
    })
    if (!snapshotValidation.ok) {
      throw new Error(snapshotValidation.errors.join("; "))
    }

    return {
      aggregateMs,
      engineMs,
      aggregate: {
        status: aggregate.degraded ? "partial" : "complete",
        ...geometryMetrics(aggregate.fogData),
        warningCount: sumCounts(aggregate.warningCounts),
        infoCount: sumCounts(aggregate.infoCounts),
        coverageReducedCount: sumCounts(aggregate.coverageReducedCounts),
        geometryFallbackCount: aggregate.geometryFallbackCount,
      },
      engine: {
        status: snapshot.completeness,
        ...geometryMetrics(snapshot.geometry),
        serializedSnapshotBytes: new TextEncoder().encode(
          JSON.stringify(snapshot)
        ).byteLength,
        warningCount: sumCounts(snapshot.diagnostics.warningCounts),
        infoCount: sumCounts(snapshot.diagnostics.infoCounts),
        coverageReducedCount: sumCounts(
          snapshot.diagnostics.coverageReducedCounts
        ),
        geometryFallbackCount: snapshot.diagnostics.geometryFallbackCount ?? 0,
      },
    }
  }

  return {
    fixture: {
      path: "public/sample-run.gpx",
      activityCount: 1,
      inputPoints: sanitized.inputPointCount,
      sanitizedPoints: sanitized.outputPointCount,
      maskCount: buffered.masks.length,
      coalescedPointCount:
        buffered.warningCounts.coalesced_duplicate_point ?? 0,
      warningExampleCount: buffered.warnings.length,
    },
    stages: {
      sanitizeMs,
      bufferMs,
      emittedSimplificationMs: emissionMs,
      validationMs: {
        raw: rawValidationMs,
        emitted: emittedValidationMs,
      },
      rawMask: geometryMetrics(rawMasks),
      emittedMask: geometryMetrics(emittedMasksData),
      rawValidation: {
        status: rawValidation.status,
        vertexCount: rawValidation.vertexCount,
        issueCodes: rawValidation.errorCodes,
      },
      emittedValidation: {
        status: emittedValidation.status,
        vertexCount: emittedValidation.vertexCount,
        issueCodes: emittedValidation.errorCodes,
      },
    },
    modes: {
      corridor: await benchmarkMode("corridor"),
      fill: await benchmarkMode("fill"),
    },
  }
}

interface EngineBenchmarkResult {
  corpus: {
    activityCount: number
    pointsPerActivity: number
  }
  medianMs: number
  p95Ms: number
  updateCount: number
  status: "complete" | "partial"
  publishedBytes: number
  finalPayloadBytes: number
  degraded: boolean
  geometryFallbackCount: number
  rejectedActivityCount: number
  metrics: ReturnType<typeof geometryMetrics>
}

async function benchmarkEngineScale(
  count: number
): Promise<EngineBenchmarkResult> {
  const activities = makeScaleActivities(count)
  const durations: number[] = []
  const updateCounts: number[] = []
  const publishedBytes: number[] = []
  const finalPayloadBytes: number[] = []
  let finalResult: FogEngineResult | null = null

  const iterations = count >= 10_000 ? 1 : ITERATIONS
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let updateCount = 0
    let publishedByteCount = 0
    const engine = createFogEngine({
      emitIntervalMs: FOG_EMIT_INTERVAL_MS,
      hooks: {
        yieldToScheduler: () =>
          new Promise<void>((resolve) => setImmediate(resolve)),
        onUpdate: (snapshot) => {
          updateCount += 1
          const cloned = structuredClone(snapshot)
          const validation = validateFogRenderData(cloned.geometry, {
            allowInteriorRings: true,
          })
          if (!validation.ok) {
            throw new Error(validation.errors.join("; "))
          }
          publishedByteCount += new TextEncoder().encode(
            JSON.stringify(cloned)
          ).byteLength
        },
      },
    })
    const request: FogRequest = {
      protocolVersion: FOG_PROTOCOL_VERSION,
      requestId: `engine-benchmark-${count}-${iteration}`,
      generation: iteration + 1,
      libraryRevision: iteration + 1,
      coverageRevision: iteration + 1,
      mode: "corridor",
      kind: "rebuild",
      activities,
    }
    const started = performance.now()
    const result = await engine.process(request)
    const final =
      result.status === "complete" || result.status === "partial"
        ? structuredClone(result.snapshot)
        : null
    if (!final)
      throw new Error(`engine benchmark failed at ${count} activities`)
    const validation = validateFogRenderData(final.geometry, {
      allowInteriorRings: true,
    })
    if (!validation.ok) throw new Error(validation.errors.join("; "))
    const finalBytes = new TextEncoder().encode(
      JSON.stringify(final)
    ).byteLength
    durations.push(performance.now() - started)
    updateCounts.push(updateCount)
    publishedBytes.push(publishedByteCount)
    finalPayloadBytes.push(finalBytes)
    finalResult = result
  }

  const snapshot =
    finalResult?.status === "complete" || finalResult?.status === "partial"
      ? finalResult.snapshot
      : null
  if (!snapshot) throw new Error("engine benchmark did not produce a snapshot")
  return {
    corpus: { activityCount: count, pointsPerActivity: 2 },
    medianMs: Number(median(durations).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    updateCount: Math.max(...updateCounts),
    status: snapshot.completeness,
    publishedBytes: Math.max(...publishedBytes),
    finalPayloadBytes: Math.max(...finalPayloadBytes),
    degraded: snapshot.diagnostics.degraded,
    geometryFallbackCount: snapshot.diagnostics.geometryFallbackCount ?? 0,
    rejectedActivityCount: snapshot.diagnostics.rejectedActivityCount ?? 0,
    metrics: geometryMetrics(snapshot.geometry),
  }
}

const realFixture = await loadRealFixture()
const bufferedActivities = realFixture.activities.map((activity) =>
  bufferFogActivity(activity)
)
const masks = bufferedActivities.flatMap((activity) => activity.masks)
const positive = featureCollection(masks) as GeometryCollection
const bounded = () => {
  const result = buildBoundedFog(masks, "corridor")
  return result.fogData
}

const baseline = {
  fixture: {
    source: REAL_DATASET_SOURCE,
    activityCount: realFixture.activities.length,
    sourceRowsScanned: realFixture.sourceRowsScanned,
    skippedRecords: realFixture.skippedRecords,
    masks: masks.length,
    inputPoints: realFixture.activities.reduce(
      (total, activity) => total + activity.coordinates.length,
      0
    ),
    rejectedActivities: bufferedActivities.filter(
      (activity) => activity.rejected
    ).length,
  },
  candidates: [
    safeBenchmark("positive-explored-mask", () => positive),
    safeBenchmark("positive-mask-aggregated", bounded),
    safeBenchmark("global-hole-reference", () => globalHole(masks)),
  ],
}

console.log(
  JSON.stringify(
    {
      baseline,
      publicSample: await benchmarkPublicSample(),
      scaleTiers: SCALE_TIERS.map(benchmarkScale),
      engineScaleTiers: await Promise.all(
        SCALE_TIERS.map(benchmarkEngineScale)
      ),
    },
    null,
    2
  )
)
