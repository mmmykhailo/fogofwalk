import { createReadStream } from "node:fs"
import { mkdir, open, rename, stat } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { dirname } from "node:path"

import { zxyToTileId } from "pmtiles"

import type { GeometryBounds } from "./geometry"

const HEADER_SIZE = 127
const DEFAULT_LEAF_SIZE = 4096
const encoder = new TextEncoder()

export interface TileRecord {
  tileId: number
  bytes: Uint8Array
  featureCount: number
}

export interface PmtilesWriteOptions {
  output: string
  tiles: AsyncIterable<TileRecord>
  metadata: Record<string, unknown>
  bounds: GeometryBounds
  center?: [number, number]
  leafSize?: number
  forceLeafDirectories?: boolean
  signal?: AbortSignal
}

export interface PmtilesWriteResult {
  output: string
  bytes: number
  tileCount: number
  featureCount: number
  maxCompressedTileBytes: number
  leafDirectoryCount: number
  usedLeafDirectories: boolean
}

export interface DirectoryEntry {
  tileId: number
  offset: number
  length: number
  runLength: number
}

/** Writes a PMTiles v3 archive from a sorted async tile stream. */
export async function writePmtilesArchive(
  options: PmtilesWriteOptions
): Promise<PmtilesWriteResult> {
  const leafSize = options.leafSize ?? DEFAULT_LEAF_SIZE
  if (!Number.isInteger(leafSize) || leafSize < 1) {
    throw new Error("PMTiles leafSize must be a positive integer")
  }
  validateBounds(options.bounds)
  await mkdir(dirname(options.output), { recursive: true })
  const tileDataPath = `${options.output}.tile-data.incomplete`
  const leafDataPath = `${options.output}.leaf-data.incomplete`
  const tileData = await open(tileDataPath, "w")
  const leafData = await open(leafDataPath, "w")
  let tileDataOffset = 0
  let leafDataOffset = 0
  let tileCount = 0
  let featureCount = 0
  let maxCompressedTileBytes = 0
  let previousTileId = -1
  let useLeaves = options.forceLeafDirectories === true
  let smallEntries: DirectoryEntry[] = []
  let currentLeaf: DirectoryEntry[] = []
  const rootEntries: DirectoryEntry[] = []

  const flushLeaf = async (): Promise<void> => {
    if (currentLeaf.length === 0) return
    const bytes = gzipSync(serializeDirectory(currentLeaf))
    await writeFileBytes(leafData, bytes)
    rootEntries.push({
      tileId: currentLeaf[0]?.tileId ?? 0,
      offset: leafDataOffset,
      length: bytes.length,
      runLength: 0,
    })
    leafDataOffset += bytes.length
    currentLeaf = []
  }

  try {
    for await (const record of options.tiles) {
      throwIfAborted(options.signal)
      if (
        !Number.isSafeInteger(record.tileId) ||
        record.tileId <= previousTileId
      ) {
        throw new Error(
          "PMTiles tile stream must be strictly sorted by tile ID"
        )
      }
      if (record.bytes.length === 0)
        throw new Error("PMTiles tile cannot be empty")
      previousTileId = record.tileId
      const entry: DirectoryEntry = {
        tileId: record.tileId,
        offset: tileDataOffset,
        length: record.bytes.length,
        runLength: 1,
      }
      await writeFileBytes(tileData, record.bytes)
      tileDataOffset += record.bytes.length
      tileCount++
      featureCount += record.featureCount
      maxCompressedTileBytes = Math.max(
        maxCompressedTileBytes,
        record.bytes.length
      )

      if (useLeaves) {
        currentLeaf.push(entry)
        if (currentLeaf.length >= leafSize) await flushLeaf()
      } else if (options.forceLeafDirectories) {
        useLeaves = true
        currentLeaf.push(entry)
      } else if (smallEntries.length < leafSize) {
        smallEntries.push(entry)
      } else {
        useLeaves = true
        currentLeaf = smallEntries
        smallEntries = []
        await flushLeaf()
        currentLeaf.push(entry)
      }
    }
    if (useLeaves) {
      await flushLeaf()
    }
  } finally {
    await tileData.sync()
    await leafData.sync()
    await tileData.close()
    await leafData.close()
  }

  const directEntries = useLeaves ? [] : smallEntries
  const root = gzipSync(
    serializeDirectory(useLeaves ? rootEntries : directEntries)
  )
  const metadata = gzipSync(encoder.encode(stableJson(options.metadata)))
  const leafLength = useLeaves ? leafDataOffset : 0
  const rootOffset = HEADER_SIZE
  const metadataOffset = rootOffset + root.length
  const leafOffset = useLeaves ? metadataOffset + metadata.length : 0
  const tileOffset = useLeaves
    ? leafOffset + leafLength
    : metadataOffset + metadata.length
  const center = options.center ?? [
    (options.bounds.minLon + options.bounds.maxLon) / 2,
    (options.bounds.minLat + options.bounds.maxLat) / 2,
  ]
  const header = writeHeader({
    rootOffset,
    rootLength: root.length,
    metadataOffset,
    metadataLength: metadata.length,
    leafOffset,
    leafLength,
    tileOffset,
    tileLength: tileDataOffset,
    tileCount,
    tileEntryCount: tileCount,
    tileContentCount: tileCount,
    bounds: options.bounds,
    center,
  })

  const outputHandle = await open(options.output, "w")
  try {
    await writeFileBytes(outputHandle, header)
    await writeFileBytes(outputHandle, root)
    await writeFileBytes(outputHandle, metadata)
    if (useLeaves) await copyFileBytes(leafDataPath, outputHandle)
    await copyFileBytes(tileDataPath, outputHandle)
    await outputHandle.sync()
  } finally {
    await outputHandle.close()
  }
  const outputBytes = (await stat(options.output)).size
  return {
    output: options.output,
    bytes: outputBytes,
    tileCount,
    featureCount,
    maxCompressedTileBytes,
    leafDirectoryCount: rootEntries.length,
    usedLeafDirectories: useLeaves,
  }
}

export function serializeDirectory(entries: DirectoryEntry[]): Uint8Array {
  if (
    entries.some(
      (entry) => !Number.isSafeInteger(entry.tileId) || entry.tileId < 0
    )
  ) {
    throw new Error("directory tile IDs must be safe non-negative integers")
  }
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1]?.tileId >= entries[index]?.tileId) {
      throw new Error("directory tile IDs must be strictly sorted")
    }
  }
  const chunks: Uint8Array[] = [varint(entries.length)]
  let previousTileId = 0
  for (const entry of entries) {
    chunks.push(varint(entry.tileId - previousTileId))
    previousTileId = entry.tileId
  }
  for (const entry of entries) chunks.push(varint(entry.runLength))
  for (const entry of entries) chunks.push(varint(entry.length))
  let previousOffset = 0
  let previousLength = 0
  entries.forEach((entry, index) => {
    const encodedOffset =
      index > 0 && entry.offset === previousOffset + previousLength
        ? 0
        : entry.offset + 1
    chunks.push(varint(encodedOffset))
    previousOffset = entry.offset
    previousLength = entry.length
  })
  return concat(chunks)
}

export function deserializeDirectory(bytes: Uint8Array): DirectoryEntry[] {
  const cursor = { bytes, offset: 0 }
  const count = readSafeVarint(cursor)
  const entries = Array.from({ length: count }, () => ({
    tileId: 0,
    offset: 0,
    length: 0,
    runLength: 1,
  }))
  let previousTileId = 0
  for (const entry of entries) {
    previousTileId += readSafeVarint(cursor)
    entry.tileId = previousTileId
  }
  for (const entry of entries) entry.runLength = readSafeVarint(cursor)
  for (const entry of entries) entry.length = readSafeVarint(cursor)
  let previousOffset = 0
  let previousLength = 0
  entries.forEach((entry, index) => {
    const encoded = readSafeVarint(cursor)
    entry.offset =
      encoded === 0 && index > 0 ? previousOffset + previousLength : encoded - 1
    previousOffset = entry.offset
    previousLength = entry.length
  })
  if (cursor.offset !== bytes.length) {
    throw new Error("PMTiles directory has trailing bytes")
  }
  return entries
}

export function tileIdForZxy(zoom: number, x: number, y: number): number {
  return zxyToTileId(zoom, x, y)
}

function writeHeader(options: {
  rootOffset: number
  rootLength: number
  metadataOffset: number
  metadataLength: number
  leafOffset: number
  leafLength: number
  tileOffset: number
  tileLength: number
  tileCount: number
  tileEntryCount: number
  tileContentCount: number
  bounds: GeometryBounds
  center: [number, number]
}): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE)
  header.set(encoder.encode("PMTiles"), 0)
  const view = new DataView(header.buffer)
  view.setUint8(7, 3)
  setUint64(view, 8, options.rootOffset)
  setUint64(view, 16, options.rootLength)
  setUint64(view, 24, options.metadataOffset)
  setUint64(view, 32, options.metadataLength)
  setUint64(view, 40, options.leafOffset)
  setUint64(view, 48, options.leafLength)
  setUint64(view, 56, options.tileOffset)
  setUint64(view, 64, options.tileLength)
  setUint64(view, 72, options.tileCount)
  setUint64(view, 80, options.tileEntryCount)
  setUint64(view, 88, options.tileContentCount)
  view.setUint8(96, 1)
  view.setUint8(97, 2)
  view.setUint8(98, 2)
  view.setUint8(99, 1)
  view.setUint8(100, 12)
  view.setUint8(101, 12)
  setInt32Coordinate(view, 102, options.bounds.minLon)
  setInt32Coordinate(view, 106, options.bounds.minLat)
  setInt32Coordinate(view, 110, options.bounds.maxLon)
  setInt32Coordinate(view, 114, options.bounds.maxLat)
  view.setUint8(118, 12)
  setInt32Coordinate(view, 119, options.center[0])
  setInt32Coordinate(view, 123, options.center[1])
  return header
}

function setUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `PMTiles header value is not a safe unsigned integer: ${value}`
    )
  }
  view.setUint32(offset, value % 2 ** 32, true)
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true)
}

function setInt32Coordinate(
  view: DataView,
  offset: number,
  value: number
): void {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new Error(
      `PMTiles coordinate is outside the supported range: ${value}`
    )
  }
  view.setInt32(offset, Math.round(value * 10_000_000), true)
}

function validateBounds(bounds: GeometryBounds): void {
  if (
    !Number.isFinite(bounds.minLon) ||
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLon) ||
    !Number.isFinite(bounds.maxLat) ||
    bounds.minLon < -180 ||
    bounds.maxLon > 180 ||
    bounds.minLon >= bounds.maxLon ||
    bounds.minLat < -85.051129 ||
    bounds.maxLat > 85.051129 ||
    bounds.minLat >= bounds.maxLat
  ) {
    throw new Error("PMTiles bounds are invalid")
  }
}

async function copyFileBytes(
  path: string,
  destination: Awaited<ReturnType<typeof open>>
): Promise<void> {
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
  })) {
    await writeFileBytes(destination, chunk)
  }
}

async function writeFileBytes(
  file: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array
): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    const result = await file.write(bytes, offset, bytes.length - offset)
    offset += result.bytesWritten
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function varint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid PMTiles varint: ${value}`)
  }
  const result: number[] = []
  let remaining = value
  while (remaining >= 128) {
    result.push((remaining % 128) + 128)
    remaining = Math.floor(remaining / 128)
  }
  result.push(remaining)
  return Uint8Array.from(result)
}

function readSafeVarint(cursor: { bytes: Uint8Array; offset: number }): number {
  let result = 0
  let multiplier = 1
  for (let index = 0; index < 10; index++) {
    const byte = cursor.bytes[cursor.offset++]
    if (byte === undefined)
      throw new Error("truncated PMTiles directory varint")
    result += (byte & 0x7f) * multiplier
    if (result > Number.MAX_SAFE_INTEGER) {
      throw new Error("PMTiles directory varint exceeds safe integer range")
    }
    if (byte < 128) return result
    multiplier *= 128
  }
  throw new Error("PMTiles directory varint is too long")
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("trail build cancelled")
}
