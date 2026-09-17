import { mkdir, writeFile } from "node:fs/promises"
import { dirname, basename } from "node:path"

import type {
  Bounds,
  VerifiedSourceManifest,
  SourceManifest,
} from "./source-manifest"

export interface TrailCounts {
  acceptedRelations: number
  hikingRelations: number
  cyclingRelations: number
  superRelations: number
  relationMembers: number
  relationCycles: number
  missingRelations: number
  uniqueMemberWays: number
  memberWaysSeen: number
  emittedWays: number
  emittedFeatures: number
  missingNodes: number
  invalidGeometries: number
  unsupportedColors: number
  duplicateSourceObjects: number
  sourceConflicts: number
  overlapCapWays: number
  droppedOverlapKeys: number
  tiles: number
  decodedVerificationFeatures: number
}

export interface TrailPassMetric {
  name: string
  elapsedMs: number
  peakResidentMemoryBytes: number
  scratchBytes: number
  rowsRead: number
  rowsRetained: number
  failures: number
}

export interface TrailBuildReportObject {
  schemaVersion: 1
  coverage: { kind: "global" | "regional"; bounds: Bounds }
  snapshot: string
  inputs: unknown[]
  attribution: string
  dataLicense: "ODbL-1.0"
  osmSnapshot: string
  osmSourceUrl: string
  osmSourceChecksum: string
  builder: {
    name: "fogofwalk-trails"
    language: "typescript"
    bunVersion: string
    gitCommit: string
  }
  archive: {
    file: string
    sha256: string
    bytes: number
    minzoom: 12
    maxzoom: 12
  }
  counts: TrailCounts
  metrics: {
    wallTimeMs: number
    peakResidentMemoryBytes: number
    scratchDiskHighWaterMarkBytes: number
    tileCount: number
    maxCompressedTileBytes: number
    p50CompressedTileBytes: number
    p95CompressedTileBytes: number
    p99CompressedTileBytes: number
    densestZ12Tiles: Array<{ id: number; length: number }>
    leafDirectoryCount: number
    usedLeafDirectories: boolean
    passMetrics: TrailPassMetric[]
  }
}

export class TrailBuildReport {
  readonly counts: TrailCounts = {
    acceptedRelations: 0,
    hikingRelations: 0,
    cyclingRelations: 0,
    superRelations: 0,
    relationMembers: 0,
    relationCycles: 0,
    missingRelations: 0,
    uniqueMemberWays: 0,
    memberWaysSeen: 0,
    emittedWays: 0,
    emittedFeatures: 0,
    missingNodes: 0,
    invalidGeometries: 0,
    unsupportedColors: 0,
    duplicateSourceObjects: 0,
    sourceConflicts: 0,
    overlapCapWays: 0,
    droppedOverlapKeys: 0,
    tiles: 0,
    decodedVerificationFeatures: 0,
  }

  readonly passMetrics: TrailPassMetric[] = []
  private startedAt = Date.now()
  private peakResidentMemoryBytes = process.memoryUsage().rss
  private scratchDiskHighWaterMarkBytes = 0

  sampleRuntime(scratchBytes = 0): void {
    this.peakResidentMemoryBytes = Math.max(
      this.peakResidentMemoryBytes,
      process.memoryUsage().rss
    )
    this.scratchDiskHighWaterMarkBytes = Math.max(
      this.scratchDiskHighWaterMarkBytes,
      scratchBytes
    )
  }

  recordPass(
    name: string,
    startedAt: number,
    rowsRead: number,
    rowsRetained: number,
    failures: number,
    scratchBytes: number
  ): void {
    this.sampleRuntime(scratchBytes)
    this.passMetrics.push({
      name,
      elapsedMs: Date.now() - startedAt,
      peakResidentMemoryBytes: this.peakResidentMemoryBytes,
      scratchBytes,
      rowsRead,
      rowsRetained,
      failures,
    })
  }

  toObject(options: {
    coverage: SourceManifest["coverage"]
    snapshot: string
    inputs: unknown[]
    archivePath: string
    archiveSha256: string
    archiveBytes: number
    tileCount: number
    maxCompressedTileBytes: number
    p50CompressedTileBytes: number
    p95CompressedTileBytes: number
    p99CompressedTileBytes: number
    densestZ12Tiles: Array<{ id: number; length: number }>
    leafDirectoryCount: number
    usedLeafDirectories: boolean
  }): TrailBuildReportObject {
    const firstInput = options.inputs[0] as
      | {
          sourceUrl?: string
          publishedChecksum?: { algorithm: string; value: string }
        }
      | undefined
    const publishedChecksum = firstInput?.publishedChecksum
    return {
      schemaVersion: 1,
      coverage: options.coverage,
      snapshot: options.snapshot,
      inputs: options.inputs,
      attribution: "© OpenStreetMap contributors",
      dataLicense: "ODbL-1.0",
      osmSnapshot: options.snapshot,
      osmSourceUrl: firstInput?.sourceUrl ?? "fixture://marked-routes",
      osmSourceChecksum: publishedChecksum
        ? `${publishedChecksum.algorithm}:${publishedChecksum.value}`
        : "fixture",
      builder: {
        name: "fogofwalk-trails",
        language: "typescript",
        bunVersion: typeof Bun === "undefined" ? "unknown" : Bun.version,
        gitCommit: process.env.TRAIL_BUILDER_GIT_COMMIT ?? "unknown",
      },
      archive: {
        file: basename(options.archivePath),
        sha256: options.archiveSha256,
        bytes: options.archiveBytes,
        minzoom: 12,
        maxzoom: 12,
      },
      counts: { ...this.counts },
      metrics: {
        wallTimeMs: Date.now() - this.startedAt,
        peakResidentMemoryBytes: this.peakResidentMemoryBytes,
        scratchDiskHighWaterMarkBytes: this.scratchDiskHighWaterMarkBytes,
        tileCount: options.tileCount,
        maxCompressedTileBytes: options.maxCompressedTileBytes,
        p50CompressedTileBytes: options.p50CompressedTileBytes,
        p95CompressedTileBytes: options.p95CompressedTileBytes,
        p99CompressedTileBytes: options.p99CompressedTileBytes,
        densestZ12Tiles: options.densestZ12Tiles,
        leafDirectoryCount: options.leafDirectoryCount,
        usedLeafDirectories: options.usedLeafDirectories,
        passMetrics: [...this.passMetrics],
      },
    }
  }

  async write(path: string, report: TrailBuildReportObject): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  }
}

export function verifiedInputsForReport(
  manifest: VerifiedSourceManifest | null
): unknown[] {
  return manifest?.inputs.map((input) => ({ ...input })) ?? []
}
