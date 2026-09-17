import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  mkdtemp,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { gzipSync } from "node:zlib"

import { tileIdToZxy } from "pmtiles"

import {
  parseArguments,
  optionalInteger,
  requiredOption,
} from "./src/arguments"
import { BuildStore } from "./src/build-store"
import {
  assembleWayFeatures,
  boundsForCoordinates,
  mergeBounds,
  type GeometryBounds,
} from "./src/geometry"
import { encodeMvtTile } from "./src/mvt"
import {
  iterateOsmPbf,
  readOsmPbfHeader,
  writeOsmPbf,
  type OsmPrimitiveBlock,
} from "./src/osm-pbf"
import { readOsmXml } from "./src/osm-xml-fixture"
import { writePmtilesArchive, type TileRecord } from "./src/pmtiles-writer"
import { TrailBuildReport, verifiedInputsForReport } from "./src/report"
import { writePublicationArtifacts } from "./src/publication"
import {
  fileDigest,
  loadSourceManifest,
  verifySourceManifest,
  type Bounds,
  type SourceManifest,
  type VerifiedSourceManifest,
} from "./src/source-manifest"
import { resolveRelationGraph } from "./src/relation-graph"
import { TileSpool } from "./src/tile-spool"
import { verifyArchive } from "./src/verify"

const TRAIL_METADATA_FIELDS = {
  kind: "String",
  color: "String",
  offset: "Number",
  sort: "Number",
}

interface BuildOptions {
  inputs: string[]
  manifest: VerifiedSourceManifest | null
  output: string
  reportPath: string | null
  expectedPath?: string
  coverage: SourceManifest["coverage"]
  snapshot: string
  scratchDir?: string
  keepScratch: boolean
  allowOutputOverwrite: boolean
  leafSize?: number
  forceLeafDirectories?: boolean
}

export interface BuildResult {
  output: string
  reportPath: string | null
  semanticFeatures: Array<{
    way: number
    kind: "hiking" | "cycling"
    color: string
    offset: number
    sort: number
  }>
  droppedOverlapKeys: number
  archiveSha256: string
  archiveBytes: number
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArguments(argv)
  switch (parsed.command) {
    case "fixture":
      await runFixture(parsed)
      return
    case "build":
      await runBuildCommand(parsed)
      return
    case "verify":
      await runVerifyCommand(parsed)
      return
    case "manifest":
      await runManifestCommand(parsed)
      return
    default:
      throw new Error(`unknown trail-data subcommand: ${parsed.command}`)
  }
}

async function runFixture(
  parsed: ReturnType<typeof parseArguments>
): Promise<void> {
  const trailDataDirectory = resolve(import.meta.dir)
  const xmlPath = absoluteOrDefault(
    parsed.options.get("xml"),
    join(trailDataDirectory, "fixtures/marked-routes.osm")
  )
  const pbfPath = absoluteOrDefault(
    parsed.options.get("pbf"),
    join(trailDataDirectory, "fixtures/marked-routes.osm.pbf")
  )
  if (parsed.flags.has("write-pbf") || !(await pathExists(pbfPath))) {
    await writeOsmPbf(pbfPath, await readOsmXml(xmlPath))
  }
  const output = absoluteOrDefault(
    parsed.options.get("output"),
    resolve(trailDataDirectory, "../e2e/fixtures/trails-v1.pmtiles")
  )
  const expectedPath = absoluteOrDefault(
    parsed.options.get("expected"),
    join(trailDataDirectory, "fixtures/expected-z12.json")
  )
  const reportPath = parsed.options.get("report")
    ? absoluteOrDefault(parsed.options.get("report"), `${output}.report.json`)
    : null
  const bounds: Bounds = [14.4, 50.04, 14.44, 50.19]
  const result = await buildArchive({
    inputs: [pbfPath],
    manifest: null,
    output,
    reportPath,
    expectedPath,
    coverage: { kind: "regional", bounds },
    snapshot: "fixture",
    scratchDir: parsed.options.get("scratch-dir"),
    keepScratch: parsed.flags.has("keep-scratch"),
    allowOutputOverwrite: true,
    leafSize: optionalInteger(parsed, "leaf-size", 4096),
    forceLeafDirectories: parsed.flags.has("force-leaf-directories"),
  })
  if (result.semanticFeatures.length === 0) {
    throw new Error("fixture did not emit any semantic trail features")
  }
  const expected = JSON.parse(await Bun.file(expectedPath).text()) as {
    droppedOverlapKeys?: unknown
    features?: unknown
  }
  if (
    expected.droppedOverlapKeys !== result.droppedOverlapKeys ||
    !Array.isArray(expected.features) ||
    JSON.stringify(expected.features) !==
      JSON.stringify(result.semanticFeatures)
  ) {
    throw new Error(`fixture semantic output does not match ${expectedPath}`)
  }
  console.log(
    JSON.stringify({
      archive: result.output,
      bytes: result.archiveBytes,
      sha256: result.archiveSha256,
      semanticFeatures: result.semanticFeatures.length,
      droppedOverlapKeys: result.droppedOverlapKeys,
    })
  )
}

async function runBuildCommand(
  parsed: ReturnType<typeof parseArguments>
): Promise<void> {
  const manifestPath = requiredAbsoluteOption(parsed, "manifest")
  const output = requiredAbsoluteOption(parsed, "output")
  const manifest = await verifySourceManifest(
    await loadSourceManifest(manifestPath)
  )
  const reportPath = absoluteOrDefault(
    parsed.options.get("report"),
    `${output}.report.json`
  )
  const result = await buildArchive({
    inputs: manifest.inputs.map((input) => input.path),
    manifest,
    output,
    reportPath,
    coverage: manifest.coverage,
    snapshot: manifest.snapshot,
    scratchDir: parsed.options.get("scratch-dir"),
    keepScratch: parsed.flags.has("keep-scratch"),
    allowOutputOverwrite: false,
    leafSize: optionalInteger(parsed, "leaf-size", 4096),
    forceLeafDirectories: parsed.flags.has("force-leaf-directories"),
  })
  console.log(
    JSON.stringify({
      archive: result.output,
      report: result.reportPath,
      bytes: result.archiveBytes,
      sha256: result.archiveSha256,
    })
  )
}

async function runVerifyCommand(
  parsed: ReturnType<typeof parseArguments>
): Promise<void> {
  const archive = requiredAbsoluteOption(parsed, "archive")
  const verification = await verifyArchive({
    archive,
    expected: parsed.options.get("expected")
      ? requiredAbsoluteOption(parsed, "expected")
      : undefined,
    checksum: parsed.options.get("checksum"),
  })
  const reportPath = parsed.options.get("report")
  if (reportPath) {
    const report = JSON.parse(
      await Bun.file(requiredAbsoluteOption(parsed, "report")).text()
    ) as Record<string, any>
    report.metrics ??= {}
    report.metrics.tileCount = verification.tileCount
    report.metrics.maxCompressedTileBytes = verification.maxCompressedTileBytes
    report.metrics.p50CompressedTileBytes = verification.p50CompressedTileBytes
    report.metrics.p95CompressedTileBytes = verification.p95CompressedTileBytes
    report.metrics.p99CompressedTileBytes = verification.p99CompressedTileBytes
    report.counts ??= {}
    report.counts.tiles = verification.tileCount
    report.counts.decodedVerificationFeatures = verification.featureCount
    await Bun.write(
      requiredAbsoluteOption(parsed, "report"),
      `${JSON.stringify(report, null, 2)}\n`
    )
  }
  console.log(
    JSON.stringify({
      archive,
      tiles: verification.tileCount,
      features: verification.featureCount,
      maxCompressedTileBytes: verification.maxCompressedTileBytes,
    })
  )
}

async function runManifestCommand(
  parsed: ReturnType<typeof parseArguments>
): Promise<void> {
  const artifacts = await writePublicationArtifacts({
    archive: requiredAbsoluteOption(parsed, "archive"),
    report: requiredAbsoluteOption(parsed, "report"),
    outputDir: parsed.options.get("output-dir")
      ? requiredAbsoluteOption(parsed, "output-dir")
      : undefined,
    peakResidentMemoryBytes: parsed.options.has("peak-resident-memory-bytes")
      ? Number(requiredOption(parsed, "peak-resident-memory-bytes"))
      : undefined,
    scratchDiskHighWaterMarkBytes: parsed.options.has(
      "scratch-disk-high-water-mark-bytes"
    )
      ? Number(requiredOption(parsed, "scratch-disk-high-water-mark-bytes"))
      : undefined,
  })
  console.log(JSON.stringify(artifacts))
}

async function buildArchive(options: BuildOptions): Promise<BuildResult> {
  validateOutputPath(options.output)
  if (!options.allowOutputOverwrite && (await pathExists(options.output))) {
    throw new Error(`refusing to overwrite existing archive: ${options.output}`)
  }
  for (const input of options.inputs) {
    if (!(await pathExists(input)))
      throw new Error(`OSM input is not a file: ${input}`)
    await readOsmPbfHeader(input)
  }
  const scratchBase = resolve(options.scratchDir ?? dirname(options.output))
  await mkdirForScratch(scratchBase)
  const scratch = await mkdtemp(
    join(scratchBase, ".fogofwalk-trails-incomplete-")
  )
  const archivePath = join(scratch, "archive.pmtiles.incomplete")
  const report = new TrailBuildReport()
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.on("SIGINT" as never, onSignal)
  process.on("SIGTERM" as never, onSignal)
  let store: BuildStore | null = null
  let succeeded = false
  try {
    await assertScratchHeadroom(scratch, options.manifest)
    store = await BuildStore.open(join(scratch, "build.sqlite"))
    const spool = new TileSpool(store.db)

    await runPass(report, "relation-scan", scratch, async (metrics) => {
      for (const input of options.inputs) {
        await scanInput(input, controller.signal, (block) => {
          metrics.rowsRead += block.relations.length
          store?.withTransaction(() => {
            for (const relation of block.relations) {
              store?.addRelation(relation)
              metrics.rowsRetained++
            }
          })
        })
      }
    })

    const graph = await runPass(
      report,
      "relation-resolution",
      scratch,
      async (metrics) => {
        const result = resolveRelationGraph(store?.iterateRelations() ?? [])
        metrics.rowsRead = result.stats.relationMembers
        metrics.rowsRetained = result.stats.uniqueMemberWays
        store?.replaceMemberships(result.membershipsByWay)
        return result
      }
    )
    report.counts.acceptedRelations = graph.stats.acceptedRelations
    report.counts.hikingRelations = graph.stats.hikingRelations
    report.counts.cyclingRelations = graph.stats.cyclingRelations
    report.counts.superRelations = graph.stats.superRelations
    report.counts.relationMembers = graph.stats.relationMembers
    report.counts.relationCycles = graph.stats.relationCycles
    report.counts.missingRelations = graph.stats.missingRelations
    report.counts.uniqueMemberWays = graph.stats.uniqueMemberWays
    report.counts.unsupportedColors = [...graph.accepted.values()].filter(
      (relation) => relation.unsupportedColor
    ).length

    await runPass(report, "way-scan", scratch, async (metrics) => {
      for (const input of options.inputs) {
        await scanInput(input, controller.signal, (block) => {
          metrics.rowsRead += block.ways.length
          store?.withTransaction(() => {
            metrics.rowsRetained += store?.addWays(block.ways) ?? 0
          })
        })
      }
      store?.populateWantedNodes()
    })

    await runPass(report, "node-scan", scratch, async (metrics) => {
      for (const input of options.inputs) {
        await scanInput(input, controller.signal, (block) => {
          metrics.rowsRead += block.nodes.length
          store?.withTransaction(() => {
            metrics.rowsRetained += store?.addNodes(block.nodes) ?? 0
          })
        })
      }
    })

    const semanticFeatures: BuildResult["semanticFeatures"] = []
    let bounds: GeometryBounds | null = null
    await runPass(report, "geometry-assembly", scratch, async (metrics) => {
      for (const selected of store?.iterateSelectedWays() ?? []) {
        metrics.rowsRead++
        report.counts.memberWaysSeen++
        const nodes = store?.nodesForRefs(selected.way.nodeRefs) ?? new Map()
        const missing = selected.way.nodeRefs.filter(
          (id) => !nodes.has(id)
        ).length
        if (missing > 0) report.counts.missingNodes += missing
        const assembled = assembleWayFeatures(
          selected.way,
          nodes,
          selected.memberships
        )
        if (assembled.invalid) {
          report.counts.invalidGeometries++
          metrics.failures++
          continue
        }
        if (assembled.features.length === 0) continue
        report.counts.emittedWays++
        report.counts.emittedFeatures += assembled.features.length
        report.counts.droppedOverlapKeys += assembled.droppedKeys
        if (assembled.droppedKeys > 0) report.counts.overlapCapWays++
        metrics.rowsRetained += assembled.features.length
        for (const feature of assembled.features) {
          semanticFeatures.push({ way: feature.wayId, ...feature.properties })
          bounds = mergeBounds(
            bounds,
            boundsForCoordinates(feature.geometry.coordinates)
          )
          spool.addFeature(feature, 12)
        }
      }
    })

    const archiveBounds = bounds ?? boundsFromCoverage(options.coverage.bounds)
    const metadata = buildMetadata(
      [
        archiveBounds.minLon,
        archiveBounds.minLat,
        archiveBounds.maxLon,
        archiveBounds.maxLat,
      ],
      options.snapshot
    )
    const writeResult = await runPass(
      report,
      "mvt-packing",
      scratch,
      async (metrics) => {
        const result = await writePmtilesArchive({
          output: archivePath,
          metadata,
          bounds: archiveBounds,
          leafSize: options.leafSize,
          forceLeafDirectories: options.forceLeafDirectories,
          signal: controller.signal,
          tiles: encodeTiles(spool, metrics, controller.signal),
        })
        metrics.rowsRead = spool.count()
        metrics.rowsRetained = result.tileCount
        return result
      }
    )

    const verification = await runPass(
      report,
      "independent-verification",
      scratch,
      async (metrics) => {
        const result = await verifyArchive({
          archive: archivePath,
          expected: options.expectedPath,
        })
        metrics.rowsRead = result.tileCount
        metrics.rowsRetained = result.featureCount
        return result
      }
    )
    report.counts.duplicateSourceObjects = store.counters.duplicateSourceObjects
    report.counts.sourceConflicts = store.counters.sourceConflicts
    report.counts.tiles = verification.tileCount
    report.counts.decodedVerificationFeatures = verification.featureCount
    report.sampleRuntime(await directoryBytes(scratch))

    const archiveSha256 = await fileDigest(archivePath, "sha256")
    const archiveBytes = (await stat(archivePath)).size
    const reportObject = report.toObject({
      coverage: options.coverage,
      snapshot: options.snapshot,
      inputs: verifiedInputsForReport(
        options.manifest && "inputs" in options.manifest
          ? options.manifest
          : null
      ),
      archivePath: options.output,
      archiveSha256,
      archiveBytes,
      tileCount: verification.tileCount,
      maxCompressedTileBytes: verification.maxCompressedTileBytes,
      p50CompressedTileBytes: verification.p50CompressedTileBytes,
      p95CompressedTileBytes: verification.p95CompressedTileBytes,
      p99CompressedTileBytes: verification.p99CompressedTileBytes,
      densestZ12Tiles: verification.entries
        .map((entry) => ({ id: entry.tileId, length: entry.length }))
        .sort((a, b) => b.length - a.length)
        .slice(0, 20),
      leafDirectoryCount: writeResult.leafDirectoryCount,
      usedLeafDirectories: writeResult.usedLeafDirectories,
    })
    if (options.reportPath) await report.write(options.reportPath, reportObject)
    await rename(archivePath, options.output)
    succeeded = true
    return {
      output: options.output,
      reportPath: options.reportPath,
      semanticFeatures,
      droppedOverlapKeys: report.counts.droppedOverlapKeys,
      archiveSha256,
      archiveBytes,
    }
  } finally {
    process.off("SIGINT" as never, onSignal)
    process.off("SIGTERM" as never, onSignal)
    store?.close()
    if (succeeded && !options.keepScratch) {
      await rm(scratch, { recursive: true, force: true })
    } else if (!succeeded) {
      console.error(`trail build incomplete; scratch retained at ${scratch}`)
    }
  }
}

async function* encodeTiles(
  spool: TileSpool,
  metrics: { rowsRead: number; rowsRetained: number; failures: number },
  signal: AbortSignal
): AsyncGenerator<TileRecord> {
  for (const tileId of spool.tileIds()) {
    if (signal.aborted) throw new Error("trail build cancelled")
    const [zoom, x, y] = tileIdToZxy(tileId)
    const features = spool.readTile(tileId)
    metrics.rowsRead++
    const tile = encodeMvtTile(features, zoom, x, y)
    if (!tile) continue
    metrics.rowsRetained++
    yield {
      tileId,
      bytes: gzipSync(tile, { level: 9 }),
      featureCount: features.length,
    }
  }
}

async function scanInput(
  path: string,
  signal: AbortSignal,
  visitor: (block: OsmPrimitiveBlock) => void | Promise<void>
): Promise<void> {
  for await (const block of iterateOsmPbf(path, signal)) await visitor(block)
}

async function runPass<T>(
  report: TrailBuildReport,
  name: string,
  scratch: string,
  callback: (metrics: {
    rowsRead: number
    rowsRetained: number
    failures: number
  }) => Promise<T>
): Promise<T> {
  const startedAt = Date.now()
  const metrics = { rowsRead: 0, rowsRetained: 0, failures: 0 }
  const sampler = setInterval(() => report.sampleRuntime(), 100)
  try {
    const result = await callback(metrics)
    report.recordPass(
      name,
      startedAt,
      metrics.rowsRead,
      metrics.rowsRetained,
      metrics.failures,
      await directoryBytes(scratch)
    )
    return result
  } catch (error) {
    metrics.failures++
    report.recordPass(
      name,
      startedAt,
      metrics.rowsRead,
      metrics.rowsRetained,
      metrics.failures,
      await directoryBytes(scratch)
    )
    throw error
  } finally {
    clearInterval(sampler)
  }
}

function buildMetadata(
  bounds: Bounds,
  snapshot: string
): Record<string, unknown> {
  return {
    tilejson: "3.0.0",
    name: "Fog of Walk marked trails",
    version: "1",
    format: "pbf",
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    dataLicense: "ODbL-1.0",
    description: `Marked hiking and cycling routes derived from OpenStreetMap (${snapshot})`,
    bounds,
    vector_layers: [
      {
        id: "trails",
        description: "OpenStreetMap route relation members",
        minzoom: 12,
        maxzoom: 12,
        fields: TRAIL_METADATA_FIELDS,
      },
    ],
  }
}

function boundsFromCoverage(bounds: Bounds): GeometryBounds {
  return {
    minLon: bounds[0],
    minLat: bounds[1],
    maxLon: bounds[2],
    maxLat: bounds[3],
  }
}

function validateOutputPath(path: string): void {
  if (!path.startsWith("/") || !path.endsWith(".pmtiles")) {
    throw new Error("--output must be an absolute .pmtiles file")
  }
}

function requiredAbsoluteOption(
  parsed: ReturnType<typeof parseArguments>,
  name: string
): string {
  const value = requiredOption(parsed, name)
  if (!value.startsWith("/"))
    throw new Error(`--${name} must be an absolute path`)
  return value
}

function absoluteOrDefault(
  value: string | undefined,
  fallback: string
): string {
  return value ? resolve(value) : fallback
}

async function mkdirForScratch(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function assertScratchHeadroom(
  scratch: string,
  manifest: SourceManifest | VerifiedSourceManifest | null
): Promise<void> {
  const inputBytes =
    manifest && "inputs" in manifest
      ? manifest.inputs.reduce((sum, input) => sum + (input.sizeBytes ?? 0), 0)
      : 0
  const estimate = Math.max(64 * 1024 * 1024, inputBytes * 2)
  const filesystem = await statfs(scratch)
  const available = Number(filesystem.bavail) * Number(filesystem.bsize)
  if (Number.isFinite(available) && available < estimate * 1.25) {
    throw new Error(
      `insufficient scratch headroom: need about ${Math.ceil(estimate * 1.25)} bytes, have ${Math.floor(available)}`
    )
  }
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += (await stat(child)).size
  }
  return total
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
