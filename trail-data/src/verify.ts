import { open, stat } from "node:fs/promises"
import { gunzipSync } from "node:zlib"

import { VectorTile } from "@mapbox/vector-tile"
import Pbf from "pbf"
import {
  Compression,
  PMTiles,
  bytesToHeader,
  type Header,
  type RangeResponse,
  type Source,
  tileIdToZxy,
} from "pmtiles"

import {
  HIKING_PALETTE,
  SOURCE_LAYER,
  type TrailTilePropertiesV1,
} from "./classifier"
import { deserializeDirectory, type DirectoryEntry } from "./pmtiles-writer"

const HEADER_SIZE = 127
const MAX_TILE_BYTES = 1_048_576
const ALLOWED_PROPERTIES = new Set(["kind", "color", "offset", "sort"])

export interface VerifyOptions {
  archive: string
  expected?: string
  checksum?: string
  maxTileBytes?: number
}

export interface ArchiveVerification {
  archive: string
  header: Header
  metadata: Record<string, unknown>
  entries: DirectoryEntry[]
  tileCount: number
  featureCount: number
  maxCompressedTileBytes: number
  p50CompressedTileBytes: number
  p95CompressedTileBytes: number
  p99CompressedTileBytes: number
}

export async function verifyArchive(
  options: VerifyOptions
): Promise<ArchiveVerification> {
  const archiveFile = await open(options.archive, "r")
  const archiveSize = (await stat(options.archive)).size
  const source = new LocalFileSource(archiveFile, archiveSize, options.archive)
  try {
    const headerBytes = await source.readExact(0, HEADER_SIZE)
    const magic = new TextDecoder().decode(headerBytes.slice(0, 7))
    if (magic !== "PMTiles")
      throw new Error("archive has an invalid PMTiles magic")
    const header = bytesToHeader(headerBytes.buffer as ArrayBuffer)
    if (header.specVersion !== 3 || header.tileType !== 1) {
      throw new Error("archive must be PMTiles v3 MVT")
    }
    if (header.minZoom !== 12 || header.maxZoom !== 12) {
      throw new Error("archive must contain z12 tiles only")
    }
    if (
      header.tileCompression !== Compression.Gzip ||
      header.internalCompression !== Compression.Gzip
    ) {
      throw new Error("archive directories and tiles must use gzip compression")
    }
    assertRange(
      header.rootDirectoryOffset,
      header.rootDirectoryLength,
      archiveSize,
      "root directory"
    )
    assertRange(
      header.jsonMetadataOffset,
      header.jsonMetadataLength,
      archiveSize,
      "metadata"
    )
    assertRange(
      header.tileDataOffset,
      header.tileDataLength ?? 0,
      archiveSize,
      "tile data"
    )
    if (header.leafDirectoryLength) {
      assertRange(
        header.leafDirectoryOffset,
        header.leafDirectoryLength,
        archiveSize,
        "leaf directories"
      )
    }

    const libraryArchive = new PMTiles(source)
    const libraryHeader = await libraryArchive.getHeader()
    if (libraryHeader.rootDirectoryOffset !== header.rootDirectoryOffset) {
      throw new Error("PMTiles reader disagrees with archive header")
    }
    const metadata = (await libraryArchive.getMetadata()) as Record<
      string,
      unknown
    >
    validateMetadata(metadata)
    validateMetadataBounds(metadata, header)

    const rootBytes = new Uint8Array(
      gunzipSync(
        await source.readExact(
          header.rootDirectoryOffset,
          header.rootDirectoryLength
        )
      )
    )
    const rootEntries = deserializeDirectory(rootBytes)
    const entries: DirectoryEntry[] = []
    for (const rootEntry of rootEntries) {
      if (rootEntry.runLength > 0) {
        entries.push(rootEntry)
        continue
      }
      if (!header.leafDirectoryLength) {
        throw new Error(
          "root directory references leaves but no leaf section exists"
        )
      }
      const leafOffset = header.leafDirectoryOffset + rootEntry.offset
      assertRange(
        leafOffset,
        rootEntry.length,
        header.leafDirectoryOffset + header.leafDirectoryLength,
        "leaf directory"
      )
      const leafBytes = new Uint8Array(
        gunzipSync(await source.readExact(leafOffset, rootEntry.length))
      )
      const leafEntries = deserializeDirectory(leafBytes)
      if (
        leafEntries.length === 0 ||
        leafEntries[0]?.tileId !== rootEntry.tileId
      ) {
        throw new Error("leaf directory does not begin at its root tile ID")
      }
      if (leafEntries.some((entry) => entry.runLength === 0)) {
        throw new Error("nested PMTiles leaf directories are not supported")
      }
      entries.push(...leafEntries)
    }
    validateDirectoryEntries(entries, header, archiveSize)

    const lengths: number[] = []
    let featureCount = 0
    for (const entry of entries) {
      const bytes = await source.readExact(
        header.tileDataOffset + entry.offset,
        entry.length
      )
      const tile = new Uint8Array(gunzipSync(bytes))
      const [zoom, x, y] = tileIdToZxy(entry.tileId)
      if (zoom !== 12) throw new Error(`tile ${entry.tileId} is not z12`)
      const vectorTile = new VectorTile(new Pbf(tile))
      const layer = vectorTile.layers[SOURCE_LAYER]
      if (!layer)
        throw new Error(`missing ${SOURCE_LAYER} layer in ${zoom}/${x}/${y}`)
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index)
        if (feature.type !== 2)
          throw new Error("trail archive contains a non-line feature")
        validateProperties(
          feature.properties as unknown as TrailTilePropertiesV1
        )
        featureCount++
      }
      lengths.push(entry.length)
    }

    if (options.checksum) {
      const expected = options.checksum.replace(/^sha256:/i, "").toLowerCase()
      const actual = await source.sha256()
      if (actual !== expected) throw new Error("archive checksum mismatch")
    }
    if (options.expected) {
      await validateExpectedFeatures(options.expected, entries, header, source)
    }
    return {
      archive: options.archive,
      header,
      metadata,
      entries,
      tileCount: entries.length,
      featureCount,
      maxCompressedTileBytes: Math.max(0, ...lengths),
      p50CompressedTileBytes: percentile(lengths, 0.5),
      p95CompressedTileBytes: percentile(lengths, 0.95),
      p99CompressedTileBytes: percentile(lengths, 0.99),
    }
  } finally {
    await archiveFile.close()
  }
}

export function validateMetadata(metadata: Record<string, unknown>): void {
  if (
    !String(metadata.attribution ?? "")
      .toLowerCase()
      .includes("openstreetmap")
  ) {
    throw new Error("missing OpenStreetMap attribution")
  }
  const metadataText = JSON.stringify(metadata).toLowerCase()
  if (
    !metadataText.includes("odbl-1.0") &&
    !metadataText.includes("open database license")
  ) {
    throw new Error("missing ODbL-1.0 metadata")
  }
  const layers = metadata.vector_layers
  if (
    !Array.isArray(layers) ||
    layers.length !== 1 ||
    layers[0]?.id !== SOURCE_LAYER
  ) {
    throw new Error("source layer must be trails")
  }
  const fields = layers[0]?.fields
  if (
    !fields ||
    Object.keys(fields).sort().join(",") !== "color,kind,offset,sort"
  ) {
    throw new Error("unexpected trail properties")
  }
}

function validateMetadataBounds(
  metadata: Record<string, unknown>,
  header: Header
): void {
  const value = metadata.bounds
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error("archive metadata must declare four finite bounds")
  }
  const expected = [header.minLon, header.minLat, header.maxLon, header.maxLat]
  if (
    value.some((item, index) => Math.abs(item - (expected[index] ?? 0)) > 1e-7)
  ) {
    throw new Error("archive metadata bounds do not match the PMTiles header")
  }
}

function validateDirectoryEntries(
  entries: DirectoryEntry[],
  header: Header,
  archiveSize: number
): void {
  let previousTileId = -1
  let addressedTiles = 0
  for (const entry of entries) {
    if (entry.tileId <= previousTileId || entry.runLength !== 1) {
      throw new Error("tile directory entries are not sorted single tiles")
    }
    previousTileId = entry.tileId
    addressedTiles += entry.runLength
    if (entry.length > MAX_TILE_BYTES) {
      throw new Error(`tile ${entry.tileId} exceeds 1 MiB compressed`)
    }
    assertRange(
      header.tileDataOffset + entry.offset,
      entry.length,
      archiveSize,
      "tile data entry"
    )
  }
  if (
    entries.length !== header.numTileEntries ||
    addressedTiles !== header.numAddressedTiles
  ) {
    throw new Error("PMTiles tile counts do not match directory entries")
  }
  if (header.numTileContents !== entries.length) {
    throw new Error("PMTiles tile content count does not match the archive")
  }
}

function validateProperties(properties: TrailTilePropertiesV1): void {
  if (
    Object.keys(properties).some((key) => !ALLOWED_PROPERTIES.has(key)) ||
    Object.keys(properties).length !== 4
  ) {
    throw new Error("trail feature has unexpected properties")
  }
  if (properties.kind !== "hiking" && properties.kind !== "cycling") {
    throw new Error("unknown trail kind")
  }
  if (properties.kind === "hiking") {
    if (!Object.values(HIKING_PALETTE).includes(properties.color as never)) {
      throw new Error("invalid hiking color")
    }
    if (properties.sort < 10 || properties.sort > 14) {
      throw new Error("invalid hiking sort")
    }
  } else {
    if (
      properties.color !== "#ec4899" ||
      properties.sort < 20 ||
      properties.sort > 24
    ) {
      throw new Error("invalid cycling properties")
    }
  }
  if (
    !Number.isFinite(properties.offset) ||
    !Number.isInteger(properties.sort)
  ) {
    throw new Error("invalid trail numeric properties")
  }
}

async function validateExpectedFeatures(
  path: string,
  entries: DirectoryEntry[],
  header: Header,
  source: LocalFileSource
): Promise<void> {
  const expected = JSON.parse(await Bun.file(path).text()) as {
    features?: Array<Record<string, unknown>>
  }
  const expectedKeys = new Set(
    (expected.features ?? []).map((feature) =>
      JSON.stringify({
        way: feature.way,
        kind: feature.kind,
        color: feature.color,
        offset: feature.offset,
        sort: feature.sort,
      })
    )
  )
  if (expectedKeys.size !== (expected.features ?? []).length) {
    throw new Error("expected fixture contains duplicate semantic features")
  }
  const observed = new Set<string>()
  for (const entry of entries) {
    const bytes = new Uint8Array(
      gunzipSync(
        await source.readExact(
          header.tileDataOffset + entry.offset,
          entry.length
        )
      )
    )
    const layer = new VectorTile(new Pbf(bytes)).layers[SOURCE_LAYER]
    if (!layer) continue
    for (let index = 0; index < layer.length; index++) {
      const decoded = layer.feature(index)
      if (
        typeof decoded.id !== "number" ||
        !Number.isSafeInteger(decoded.id) ||
        decoded.id < 0
      ) {
        throw new Error("fixture trail features must have stable numeric IDs")
      }
      const properties = decoded.properties
      observed.add(
        JSON.stringify({
          way: Math.floor(decoded.id / 16),
          kind: properties.kind,
          color: properties.color,
          offset: properties.offset,
          sort: properties.sort,
        })
      )
    }
  }
  if (observed.size !== expectedKeys.size) {
    throw new Error("archive fixture semantic feature count does not match")
  }
  for (const key of expectedKeys) {
    if (!observed.has(key)) {
      throw new Error(`missing expected fixture feature ${key}`)
    }
  }
}

class LocalFileSource implements Source {
  constructor(
    private readonly file: Awaited<ReturnType<typeof open>>,
    private readonly size: number,
    private readonly key: string
  ) {}

  getKey(): string {
    return this.key
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.size
    ) {
      throw new Error(`archive range is outside the file: ${offset}+${length}`)
    }
    const available = Math.min(length, this.size - offset)
    return {
      data: (await this.read(offset, available)).buffer as ArrayBuffer,
    }
  }

  async readExact(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new Error(`archive range is outside the file: ${offset}+${length}`)
    }
    return this.read(offset, length)
  }

  async sha256(): Promise<string> {
    const { createHash } = await import("node:crypto")
    const hash = createHash("sha256")
    for (let offset = 0; offset < this.size; offset += 1024 * 1024) {
      hash.update(
        await this.read(offset, Math.min(1024 * 1024, this.size - offset))
      )
    }
    return hash.digest("hex")
  }

  private async read(offset: number, length: number): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array()
    const bytes = new Uint8Array(length)
    let total = 0
    while (total < length) {
      const result = await this.file.read(
        bytes,
        total,
        length - total,
        offset + total
      )
      if (result.bytesRead === 0) throw new Error("unexpected end of archive")
      total += result.bytesRead
    }
    return bytes
  }
}

function assertRange(
  offset: number,
  length: number,
  size: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > size
  ) {
    throw new Error(`${label} exceeds archive bounds`)
  }
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? 0
  )
}
