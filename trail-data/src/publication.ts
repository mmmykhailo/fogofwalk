import { readFile, writeFile, mkdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { fileDigest } from "./source-manifest"

const MAX_COMPRESSED_TILE_BYTES = 1_048_576

export interface PublicationArtifacts {
  archive: string
  report: string
  manifest: string
  checksum: string
  license: string
  sha256: string
}

export async function writePublicationArtifacts(options: {
  archive: string
  report: string
  outputDir?: string
  peakResidentMemoryBytes?: number
  scratchDiskHighWaterMarkBytes?: number
}): Promise<PublicationArtifacts> {
  const archive = options.archive
  const reportPath = options.report
  const outputDir = options.outputDir ?? dirname(archive)
  await mkdir(outputDir, { recursive: true })
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<
    string,
    any
  >
  const sha256 = await fileDigest(archive, "sha256")
  const archiveName = basename(archive)
  if (report.schemaVersion !== 1) {
    throw new Error("build report schemaVersion must be 1")
  }
  if (report.snapshot === "fixture") {
    throw new Error("fixture trail provenance cannot be published")
  }
  if (!Array.isArray(report.inputs) || report.inputs.length === 0) {
    throw new Error("production trail publication requires source inputs")
  }
  if (report.archive?.sha256 && report.archive.sha256 !== sha256) {
    throw new Error("build report archive checksum does not match the archive")
  }

  const memberWaysSeen = safeCount(report.counts?.memberWaysSeen)
  const emittedWays = safeCount(report.counts?.emittedWays)
  const emittedFeatures = safeCount(report.counts?.emittedFeatures)
  const tiles = safeCount(report.counts?.tiles)
  const overlapCapWays = safeCount(report.counts?.overlapCapWays)
  const maxCompressedTileBytes = safeCount(
    report.metrics?.maxCompressedTileBytes
  )
  if (emittedWays === 0 || emittedFeatures === 0 || tiles === 0) {
    throw new Error(
      "production trail publication requires emitted ways, features, and tiles"
    )
  }
  if (maxCompressedTileBytes > MAX_COMPRESSED_TILE_BYTES) {
    throw new Error("compressed trail tile exceeds the 1 MiB publication gate")
  }
  if (
    emittedWays > memberWaysSeen ||
    overlapCapWays > emittedWays ||
    (emittedWays > 0 && overlapCapWays / emittedWays > 0.001)
  ) {
    throw new Error("overlap cap hit rate exceeds the 0.1% publication gate")
  }

  report.attribution = "© OpenStreetMap contributors"
  report.dataLicense = "ODbL-1.0"
  report.metrics ??= {}
  if (options.peakResidentMemoryBytes !== undefined) {
    report.metrics.peakResidentMemoryBytes = nonNegativeInteger(
      options.peakResidentMemoryBytes,
      "peakResidentMemoryBytes"
    )
  }
  if (options.scratchDiskHighWaterMarkBytes !== undefined) {
    report.metrics.scratchDiskHighWaterMarkBytes = nonNegativeInteger(
      options.scratchDiskHighWaterMarkBytes,
      "scratchDiskHighWaterMarkBytes"
    )
  }
  report.archive = {
    ...report.archive,
    file: archiveName,
    sha256,
    bytes: (await Bun.file(archive).stat()).size,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  const manifestPath = join(outputDir, `${archiveName}.manifest.json`)
  const checksumPath = `${archive}.sha256`
  const licensePath = join(outputDir, `${archiveName}.DATA-LICENSE.txt`)
  const manifest = {
    schemaVersion: report.schemaVersion,
    coverage: report.coverage,
    snapshot: report.snapshot ?? report.osmSnapshot,
    inputs: report.inputs ?? [],
    archive: report.archive,
    attribution: report.attribution,
    dataLicense: report.dataLicense,
    builder: report.builder,
    report: basename(reportPath),
    license: basename(licensePath),
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(checksumPath, `${sha256}  ${archiveName}\n`)
  await writeFile(
    licensePath,
    [
      "Fog of Walk marked trails archive",
      "",
      `Schema version: ${report.schemaVersion}`,
      `OSM snapshot: ${report.snapshot ?? report.osmSnapshot}`,
      `Archive: ${archiveName}`,
      `Archive SHA-256: ${sha256}`,
      "",
      "This archive contains data derived from OpenStreetMap and is distributed",
      "under the Open Database License 1.0 (ODbL-1.0).",
      "ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/",
      "Attribution: © OpenStreetMap contributors",
      "https://www.openstreetmap.org/copyright",
      "",
    ].join("\n")
  )
  return {
    archive,
    report: reportPath,
    manifest: manifestPath,
    checksum: checksumPath,
    license: licensePath,
    sha256,
  }
}

function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("build report counters must be non-negative safe integers")
  }
  return value
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}
