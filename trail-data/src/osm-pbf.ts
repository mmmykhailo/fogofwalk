import { createReadStream } from "node:fs"
import { writeFile } from "node:fs/promises"
import { inflateSync } from "node:zlib"

import Pbf from "pbf"

import type {
  OsmDocument,
  OsmMemberType,
  OsmNode,
  OsmRelation,
  OsmRelationMember,
  OsmWay,
} from "./osm-xml-fixture"

const MAX_BLOB_HEADER_BYTES = 64 * 1024
const MAX_BLOB_BYTES = 64 * 1024 * 1024
const DEFAULT_GRANULARITY = 100
const COORDINATE_SCALE = 1e-9

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

export interface OsmPbfHeader {
  requiredFeatures: string[]
  optionalFeatures: string[]
  writingProgram: string
  source: string
}

export interface OsmPrimitiveBlock {
  nodes: OsmNode[]
  ways: OsmWay[]
  relations: OsmRelation[]
}

interface BlobHeader {
  type: string
  dataSize: number
}

interface Blob {
  header: BlobHeader
  payload: Uint8Array
}

/** Streams OSMData primitive blocks from a local .osm.pbf file. */
export async function* iterateOsmPbf(
  path: string,
  signal?: AbortSignal
): AsyncGenerator<OsmPrimitiveBlock> {
  let sawHeader = false
  for await (const blob of iterateBlobs(path, signal)) {
    throwIfAborted(signal)
    if (blob.header.type === "OSMHeader") {
      if (sawHeader)
        throw new Error("PBF contains more than one OSMHeader block")
      decodeHeaderBlock(blob.payload)
      sawHeader = true
      continue
    }
    if (blob.header.type !== "OSMData") continue
    if (!sawHeader)
      throw new Error("PBF OSMData block appears before OSMHeader")
    yield decodePrimitiveBlock(blob.payload)
  }
  if (!sawHeader) throw new Error("PBF does not contain an OSMHeader block")
}

export async function readOsmPbfHeader(path: string): Promise<OsmPbfHeader> {
  for await (const blob of iterateBlobs(path)) {
    if (blob.header.type !== "OSMHeader") {
      throw new Error("PBF does not start with an OSMHeader block")
    }
    return decodeHeaderBlock(blob.payload)
  }
  throw new Error("PBF is empty")
}

export async function scanOsmPbf(
  path: string,
  visitor: (block: OsmPrimitiveBlock) => void | Promise<void>,
  signal?: AbortSignal
): Promise<OsmPbfHeader> {
  const header = await readOsmPbfHeader(path)
  for await (const block of iterateOsmPbf(path, signal)) {
    throwIfAborted(signal)
    await visitor(block)
  }
  return header
}

function decodeHeaderBlock(bytes: Uint8Array): OsmPbfHeader {
  const result: OsmPbfHeader = {
    requiredFeatures: [],
    optionalFeatures: [],
    writingProgram: "",
    source: "",
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 4:
        target.requiredFeatures.push(reader.readString())
        break
      case 5:
        target.optionalFeatures.push(reader.readString())
        break
      case 16:
        target.writingProgram = reader.readString()
        break
      case 17:
        target.source = reader.readString()
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, result)
  const supported = new Set(["OsmSchema-V0.6", "DenseNodes"])
  const unsupported = result.requiredFeatures.filter(
    (feature) => !supported.has(feature)
  )
  if (unsupported.length > 0) {
    throw new Error(
      `unsupported required PBF feature(s): ${unsupported.join(", ")}`
    )
  }
  return result
}

function decodePrimitiveBlock(bytes: Uint8Array): OsmPrimitiveBlock {
  const target = {
    stringTable: [] as string[],
    groups: [] as Uint8Array[],
    granularity: DEFAULT_GRANULARITY,
    latOffset: 0,
    lonOffset: 0,
  }

  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        reader.readMessage(readStringTable, target.stringTable)
        break
      case 2:
        target.groups.push(reader.readBytes())
        break
      case 17:
        target.granularity = reader.readVarint(true)
        break
      case 19:
        target.latOffset = reader.readVarint64()
        break
      case 20:
        target.lonOffset = reader.readVarint64()
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)

  const nodes: OsmNode[] = []
  const ways: OsmWay[] = []
  const relations: OsmRelation[] = []
  for (const groupBytes of target.groups) {
    const group = decodePrimitiveGroup(groupBytes, target.stringTable, {
      granularity: target.granularity,
      latOffset: target.latOffset,
      lonOffset: target.lonOffset,
    })
    nodes.push(...group.nodes)
    ways.push(...group.ways)
    relations.push(...group.relations)
  }
  return { nodes, ways, relations }
}

function readStringTable(tag: number, target: string[], reader: Pbf): void {
  if (tag === 1) {
    target.push(decoder.decode(reader.readBytes()))
  } else {
    reader.skip((tag << 3) | reader.type)
  }
}

function decodePrimitiveGroup(
  bytes: Uint8Array,
  strings: string[],
  coordinateOptions: {
    granularity: number
    latOffset: number
    lonOffset: number
  }
): OsmPrimitiveBlock {
  const nodes: OsmNode[] = []
  const ways: OsmWay[] = []
  const relations: OsmRelation[] = []
  const pbf = new Pbf(bytes)
  pbf.readFields(
    (tag, target, reader) => {
      switch (tag) {
        case 1:
          target.nodes.push(
            decodeNode(reader.readBytes(), strings, coordinateOptions)
          )
          break
        case 2:
          decodeDenseNodes(
            reader.readBytes(),
            strings,
            coordinateOptions,
            target.nodes
          )
          break
        case 3:
          target.ways.push(decodeWay(reader.readBytes(), strings))
          break
        case 4:
          target.relations.push(decodeRelation(reader.readBytes(), strings))
          break
        default:
          reader.skip((tag << 3) | reader.type)
      }
    },
    { nodes, ways, relations }
  )
  return { nodes, ways, relations }
}

function decodeNode(
  bytes: Uint8Array,
  strings: string[],
  coordinateOptions: {
    granularity: number
    latOffset: number
    lonOffset: number
  }
): OsmNode {
  const target = {
    keys: [] as number[],
    values: [] as number[],
    id: 0,
    latRaw: 0,
    lonRaw: 0,
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        target.id = reader.readSVarint()
        break
      case 2:
        readPackedVarint(reader, target.keys)
        break
      case 3:
        readPackedVarint(reader, target.values)
        break
      case 4:
        reader.skip((tag << 3) | reader.type)
        break
      case 8:
        target.latRaw = reader.readSVarint()
        break
      case 9:
        target.lonRaw = reader.readSVarint()
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)
  return {
    id: safeInteger(target.id, "node id"),
    version: 1,
    lat: coordinate(
      targetValue(target.latRaw, "node latitude"),
      coordinateOptions.latOffset,
      coordinateOptions.granularity
    ),
    lon: coordinate(
      targetValue(target.lonRaw, "node longitude"),
      coordinateOptions.lonOffset,
      coordinateOptions.granularity
    ),
    tags: decodeTags(target.keys, target.values, strings),
  }
}

function decodeDenseNodes(
  bytes: Uint8Array,
  strings: string[],
  coordinateOptions: {
    granularity: number
    latOffset: number
    lonOffset: number
  },
  output: OsmNode[]
): void {
  const target = {
    ids: [] as number[],
    latDeltas: [] as number[],
    lonDeltas: [] as number[],
    keysValues: [] as number[],
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        readPackedSVarint(reader, target.ids)
        break
      case 5:
        reader.skip((tag << 3) | reader.type)
        break
      case 8:
        readPackedSVarint(reader, target.latDeltas)
        break
      case 9:
        readPackedSVarint(reader, target.lonDeltas)
        break
      case 10:
        readPackedVarint(reader, target.keysValues)
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)

  if (
    target.ids.length !== target.latDeltas.length ||
    target.ids.length !== target.lonDeltas.length
  ) {
    throw new Error("dense node coordinate arrays have different lengths")
  }

  let id = 0
  let latRaw = 0
  let lonRaw = 0
  let keysValueIndex = 0
  for (let index = 0; index < target.ids.length; index++) {
    id = safeInteger(id + target.ids[index], "dense node id")
    latRaw = safeInteger(latRaw + target.latDeltas[index], "dense latitude")
    lonRaw = safeInteger(lonRaw + target.lonDeltas[index], "dense longitude")
    const tags: Record<string, string> = {}
    while (keysValueIndex < target.keysValues.length) {
      const key = target.keysValues[keysValueIndex++]
      if (key === 0) break
      if (keysValueIndex >= target.keysValues.length) {
        throw new Error("dense node tags end with a missing value")
      }
      const value = target.keysValues[keysValueIndex++]
      Object.assign(tags, decodeTags([key], [value], strings))
    }
    output.push({
      id,
      version: 1,
      lat: coordinate(
        latRaw,
        coordinateOptions.latOffset,
        coordinateOptions.granularity
      ),
      lon: coordinate(
        lonRaw,
        coordinateOptions.lonOffset,
        coordinateOptions.granularity
      ),
      tags,
    })
  }
  if (keysValueIndex < target.keysValues.length) {
    throw new Error("dense node tag table contains an orphan value")
  }
}

function decodeWay(bytes: Uint8Array, strings: string[]): OsmWay {
  const target = {
    id: 0,
    keys: [] as number[],
    values: [] as number[],
    refDeltas: [] as number[],
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        target.id = reader.readVarint64()
        break
      case 2:
        readPackedVarint(reader, target.keys)
        break
      case 3:
        readPackedVarint(reader, target.values)
        break
      case 4:
        reader.skip((tag << 3) | reader.type)
        break
      case 8:
        readPackedSVarint(reader, target.refDeltas)
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)
  let ref = 0
  const nodeRefs = target.refDeltas.map((delta) => {
    ref = safeInteger(ref + delta, "way node reference")
    return ref
  })
  return {
    id: safeInteger(target.id, "way id"),
    version: 1,
    nodeRefs,
    tags: decodeTags(target.keys, target.values, strings),
  }
}

function decodeRelation(bytes: Uint8Array, strings: string[]): OsmRelation {
  const target = {
    id: 0,
    keys: [] as number[],
    values: [] as number[],
    roles: [] as number[],
    memberDeltas: [] as number[],
    types: [] as number[],
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        target.id = reader.readVarint64()
        break
      case 2:
        readPackedVarint(reader, target.keys)
        break
      case 3:
        readPackedVarint(reader, target.values)
        break
      case 4:
        reader.skip((tag << 3) | reader.type)
        break
      case 8:
        readPackedVarint(reader, target.roles)
        break
      case 9:
        readPackedSVarint(reader, target.memberDeltas)
        break
      case 10:
        readPackedVarint(reader, target.types)
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)
  if (
    target.roles.length !== target.memberDeltas.length ||
    target.roles.length !== target.types.length
  ) {
    throw new Error("relation member arrays have different lengths")
  }
  let ref = 0
  const members: OsmRelationMember[] = target.roles.map((role, index) => {
    ref = safeInteger(
      ref + target.memberDeltas[index],
      "relation member reference"
    )
    return {
      type: decodeMemberType(target.types[index]),
      ref,
      role: stringAt(strings, role, "relation member role"),
    }
  })
  return {
    id: safeInteger(target.id, "relation id"),
    version: 1,
    tags: decodeTags(target.keys, target.values, strings),
    members,
  }
}

function decodeTags(
  keys: number[],
  values: number[],
  strings: string[]
): Record<string, string> {
  if (keys.length !== values.length) {
    throw new Error("OSM tag key/value arrays have different lengths")
  }
  const tags: Record<string, string> = {}
  for (let index = 0; index < keys.length; index++) {
    const key = stringAt(strings, keys[index], "tag key")
    const value = stringAt(strings, values[index], "tag value")
    tags[key] = value
  }
  return tags
}

function decodeMemberType(value: number): OsmMemberType {
  if (value === 0) return "node"
  if (value === 1) return "way"
  if (value === 2) return "relation"
  throw new Error(`invalid OSM relation member type: ${value}`)
}

function stringAt(strings: string[], index: number, label: string): string {
  const value = strings[index]
  if (value === undefined)
    throw new Error(`invalid ${label} string index: ${index}`)
  return value
}

function coordinate(raw: number, offset: number, granularity: number): number {
  const value = COORDINATE_SCALE * (offset + granularity * raw)
  if (!Number.isFinite(value)) throw new Error("non-finite OSM coordinate")
  return Math.round(value * 1e9) / 1e9
}

function targetValue(value: number, label: string): number {
  return safeInteger(value, label)
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value))
    throw new Error(`${label} exceeds safe integer range`)
  return value
}

function readPackedVarint(reader: Pbf, target: number[]): void {
  if (reader.type === 2) reader.readPackedVarint(target)
  else target.push(reader.readVarint())
}

function readPackedSVarint(reader: Pbf, target: number[]): void {
  if (reader.type === 2) reader.readPackedSVarint(target)
  else target.push(reader.readSVarint())
}

async function* iterateBlobs(
  path: string,
  signal?: AbortSignal
): AsyncGenerator<Blob> {
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 })
  const queue = new ByteQueue()
  for await (const chunk of stream) {
    throwIfAborted(signal)
    queue.push(chunk)
    while (queue.available >= 4) {
      const headerLength = queue.peekUint32BE()
      if (headerLength <= 0 || headerLength > MAX_BLOB_HEADER_BYTES) {
        throw new Error(`invalid PBF blob header length: ${headerLength}`)
      }
      if (queue.available < 4 + headerLength) break
      const headerBytes = queue.peek(4, headerLength)
      const header = decodeBlobHeader(headerBytes)
      if (header.dataSize < 0 || header.dataSize > MAX_BLOB_BYTES) {
        throw new Error(`invalid PBF blob data size: ${header.dataSize}`)
      }
      if (queue.available < 4 + headerLength + header.dataSize) break
      queue.discard(4 + headerLength)
      const payload = queue.read(header.dataSize)
      yield { header, payload: decodeBlob(payload) }
    }
  }
  if (queue.available !== 0) throw new Error("truncated PBF blob stream")
}

function decodeBlobHeader(bytes: Uint8Array): BlobHeader {
  const target = { type: "", dataSize: -1 }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        target.type = reader.readString()
        break
      case 3:
        target.dataSize = reader.readVarint(true)
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)
  if (!target.type) throw new Error("PBF blob header is missing its type")
  if (!Number.isSafeInteger(target.dataSize) || target.dataSize < 0) {
    throw new Error("PBF blob header has an invalid data size")
  }
  return target
}

function decodeBlob(bytes: Uint8Array): Uint8Array {
  const target = {
    raw: null as Uint8Array | null,
    zlib: null as Uint8Array | null,
    rawSize: null as number | null,
  }
  const pbf = new Pbf(bytes)
  pbf.readFields((tag, target, reader) => {
    switch (tag) {
      case 1:
        target.raw = reader.readBytes()
        break
      case 2:
        target.rawSize = reader.readVarint(true)
        break
      case 3:
        target.zlib = reader.readBytes()
        break
      default:
        reader.skip((tag << 3) | reader.type)
    }
  }, target)
  if (target.raw && target.zlib) {
    throw new Error("PBF blob contains multiple compression forms")
  }
  const decoded =
    target.raw ??
    (target.zlib ? new Uint8Array(inflateSync(target.zlib)) : null)
  if (!decoded) throw new Error("PBF blob has no supported payload")
  if (decoded.length > MAX_BLOB_BYTES)
    throw new Error("decompressed PBF blob is too large")
  if (target.rawSize !== null && target.rawSize !== decoded.length) {
    throw new Error("PBF blob raw_size does not match decoded payload")
  }
  return decoded
}

class ByteQueue {
  private chunks: Uint8Array[] = []
  private firstOffset = 0
  available = 0

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.available += chunk.length
  }

  peekUint32BE(): number {
    const bytes = this.peek(0, 4)
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    ).getUint32(0)
  }

  peek(offset: number, length: number): Uint8Array {
    if (offset < 0 || length < 0 || offset + length > this.available) {
      throw new Error("PBF byte queue underflow")
    }
    const result = new Uint8Array(length)
    let destination = 0
    let remainingOffset = offset
    for (const [index, chunk] of this.chunks.entries()) {
      const base = index === 0 ? this.firstOffset : 0
      const usable = chunk.length - base
      if (remainingOffset >= usable) {
        remainingOffset -= usable
        continue
      }
      const start = base + remainingOffset
      remainingOffset = 0
      const count = Math.min(chunk.length - start, length - destination)
      result.set(chunk.subarray(start, start + count), destination)
      destination += count
      if (destination === length) break
    }
    return result
  }

  discard(length: number): void {
    this.read(length)
  }

  read(length: number): Uint8Array {
    const result = this.peek(0, length)
    let remaining = length
    while (remaining > 0) {
      const first = this.chunks[0]
      if (!first) throw new Error("PBF byte queue underflow")
      const availableInFirst = first.length - this.firstOffset
      if (remaining < availableInFirst) {
        this.firstOffset += remaining
        remaining = 0
      } else {
        remaining -= availableInFirst
        this.chunks.shift()
        this.firstOffset = 0
      }
    }
    this.available -= length
    return result
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("trail build cancelled")
}

/** Encodes the checked-in synthetic document as a small, deterministic PBF. */
export function encodeOsmPbf(document: OsmDocument): Uint8Array {
  const entities = {
    nodes: [...document.nodes.values()].sort((a, b) => a.id - b.id),
    ways: [...document.ways.values()].sort((a, b) => a.id - b.id),
    relations: [...document.relations.values()].sort((a, b) => a.id - b.id),
  }
  const stringValues = new Set<string>([""])
  for (const entity of [
    ...entities.nodes,
    ...entities.ways,
    ...entities.relations,
  ]) {
    for (const [key, value] of Object.entries(entity.tags).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      stringValues.add(key)
      stringValues.add(value)
    }
  }
  for (const relation of entities.relations) {
    for (const member of relation.members) stringValues.add(member.role)
  }
  const strings = [...stringValues].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)
  )
  const stringIndex = new Map(strings.map((value, index) => [value, index]))

  const headerBlock = new Pbf()
  headerBlock.writeStringField(4, "OsmSchema-V0.6")
  headerBlock.writeStringField(4, "DenseNodes")
  headerBlock.writeStringField(16, "fogofwalk-typescript-fixture")

  const primitiveGroup = new Pbf()
  writeDenseNodes(primitiveGroup, entities.nodes, stringIndex)
  for (const way of entities.ways)
    primitiveGroup.writeMessage(3, writeWay, { way, stringIndex })
  for (const relation of entities.relations) {
    primitiveGroup.writeMessage(4, writeRelation, { relation, stringIndex })
  }

  const primitiveBlock = new Pbf()
  primitiveBlock.writeMessage(1, writeStringTable, { strings })
  primitiveBlock.writeMessage(2, writeRawBytes, primitiveGroup.finish())
  primitiveBlock.writeVarintField(17, DEFAULT_GRANULARITY)

  return concatBytes([
    encodeBlob("OSMHeader", headerBlock.finish()),
    encodeBlob("OSMData", primitiveBlock.finish()),
  ])
}

export async function writeOsmPbf(
  path: string,
  document: OsmDocument
): Promise<void> {
  await writeFile(path, encodeOsmPbf(document))
}

function writeStringTable(object: { strings: string[] }, pbf: Pbf): void {
  for (const value of object.strings)
    pbf.writeBytesField(1, encoder.encode(value))
}

function writeRawBytes(bytes: Uint8Array, pbf: Pbf): void {
  pbf.realloc(bytes.length)
  pbf.buf.set(bytes, pbf.pos)
  pbf.pos += bytes.length
}

function writeDenseNodes(
  parent: Pbf,
  nodes: OsmNode[],
  stringIndex: Map<string, number>
): void {
  const ids: number[] = []
  const latDeltas: number[] = []
  const lonDeltas: number[] = []
  const keysValues: number[] = []
  let previousId = 0
  let previousLat = 0
  let previousLon = 0
  for (const node of nodes) {
    const lat = safeInteger(Math.round(node.lat * 1e7), "fixture latitude")
    const lon = safeInteger(Math.round(node.lon * 1e7), "fixture longitude")
    ids.push(node.id - previousId)
    latDeltas.push(lat - previousLat)
    lonDeltas.push(lon - previousLon)
    previousId = node.id
    previousLat = lat
    previousLon = lon
    for (const [key, value] of Object.entries(node.tags).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      keysValues.push(stringIndex.get(key) ?? failString(key))
      keysValues.push(stringIndex.get(value) ?? failString(value))
    }
    keysValues.push(0)
  }
  parent.writeMessage(
    2,
    (object, pbf) => {
      pbf.writePackedSVarint(1, object.ids)
      pbf.writePackedSVarint(8, object.latDeltas)
      pbf.writePackedSVarint(9, object.lonDeltas)
      pbf.writePackedVarint(10, object.keysValues)
    },
    { ids, latDeltas, lonDeltas, keysValues }
  )
}

function writeWay(
  object: { way: OsmWay; stringIndex: Map<string, number> },
  pbf: Pbf
): void {
  pbf.writeVarintField(1, object.way.id)
  writeTags(pbf, object.way.tags, object.stringIndex)
  let previous = 0
  pbf.writePackedSVarint(
    8,
    object.way.nodeRefs.map((ref) => {
      const delta = ref - previous
      previous = ref
      return delta
    })
  )
}

function writeRelation(
  object: { relation: OsmRelation; stringIndex: Map<string, number> },
  pbf: Pbf
): void {
  pbf.writeVarintField(1, object.relation.id)
  writeTags(pbf, object.relation.tags, object.stringIndex)
  let previous = 0
  const roles: number[] = []
  const refs: number[] = []
  const types: number[] = []
  for (const member of object.relation.members) {
    roles.push(object.stringIndex.get(member.role) ?? failString(member.role))
    refs.push(member.ref - previous)
    previous = member.ref
    types.push(member.type === "node" ? 0 : member.type === "way" ? 1 : 2)
  }
  pbf.writePackedVarint(8, roles)
  pbf.writePackedSVarint(9, refs)
  pbf.writePackedVarint(10, types)
}

function writeTags(
  pbf: Pbf,
  tags: Record<string, string>,
  stringIndex: Map<string, number>
): void {
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))
  pbf.writePackedVarint(
    2,
    entries.map(([key]) => stringIndex.get(key) ?? failString(key))
  )
  pbf.writePackedVarint(
    3,
    entries.map(([, value]) => stringIndex.get(value) ?? failString(value))
  )
}

function encodeBlob(type: string, payload: Uint8Array): Uint8Array {
  const blob = new Pbf()
  blob.writeBytesField(1, payload)
  const blobBytes = blob.finish()
  const header = new Pbf()
  header.writeStringField(1, type)
  header.writeVarintField(3, blobBytes.length)
  const headerBytes = header.finish()
  const frame = new Uint8Array(4 + headerBytes.length + blobBytes.length)
  new DataView(frame.buffer).setUint32(0, headerBytes.length)
  frame.set(headerBytes, 4)
  frame.set(blobBytes, 4 + headerBytes.length)
  return frame
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function failString(value: string): never {
  throw new Error(`fixture string was not indexed: ${value}`)
}
