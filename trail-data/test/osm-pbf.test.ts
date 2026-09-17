import { expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import Pbf from "pbf"

import { encodeOsmPbf, iterateOsmPbf, readOsmPbfHeader } from "../src/osm-pbf"
import { documentEntities, parseOsmXml } from "../src/osm-xml-fixture"

test("round-trips dense nodes, ways, relation deltas, tags, and header features", async () => {
  const document = parseOsmXml(`
    <osm>
      <node id="10" lat="50.1" lon="14.4" />
      <node id="20" lat="50.2" lon="14.5" />
      <way id="30"><nd ref="10"/><nd ref="20"/></way>
      <relation id="40">
        <tag k="type" v="route"/><tag k="route" v="hiking"/>
        <member type="way" ref="30" role="forward"/>
        <member type="node" ref="10" role="guidepost"/>
      </relation>
    </osm>
  `)
  const path = `/tmp/fogofwalk-pbf-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(path, encodeOsmPbf(document))

  expect(await readOsmPbfHeader(path)).toMatchObject({
    requiredFeatures: ["OsmSchema-V0.6", "DenseNodes"],
  })
  const blocks = []
  for await (const block of iterateOsmPbf(path)) blocks.push(block)
  const nodes = blocks.flatMap((block) => block.nodes)
  const ways = blocks.flatMap((block) => block.ways)
  const relations = blocks.flatMap((block) => block.relations)
  expect(nodes.map((node) => [node.id, node.lon, node.lat])).toEqual([
    [10, 14.4, 50.1],
    [20, 14.5, 50.2],
  ])
  expect(ways[0]?.nodeRefs).toEqual([10, 20])
  expect(relations[0]?.members).toEqual([
    { type: "way", ref: 30, role: "forward" },
    { type: "node", ref: 10, role: "guidepost" },
  ])
  expect(
    documentEntities({
      nodes: new Map(nodes.map((node) => [node.id, node])),
      ways: new Map(ways.map((way) => [way.id, way])),
      relations: new Map(relations.map((relation) => [relation.id, relation])),
    }).relations[0]?.tags
  ).toEqual({
    route: "hiking",
    type: "route",
  })
})

test("accepts zlib blobs, skips unknown fields, and rejects truncated PBF data", async () => {
  const document = parseOsmXml(`<osm><node id="1" lat="1" lon="2" /></osm>`)
  const raw = encodeOsmPbf(document)
  const header = readFrame(raw, 0)
  const data = readFrame(raw, header.nextOffset)
  const unknownData = concatBytes([
    data.payload,
    Uint8Array.from([0x98, 0x06, 0x7b]),
  ])
  const unknownPath = `/tmp/fogofwalk-pbf-unknown-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(
    unknownPath,
    concatBytes([
      encodeFrame("OSMHeader", encodeRawBlob(header.payload)),
      encodeFrame("OSMData", encodeRawBlob(unknownData)),
    ])
  )
  const unknownBlocks = []
  for await (const block of iterateOsmPbf(unknownPath))
    unknownBlocks.push(block)
  expect(unknownBlocks[0]?.nodes[0]?.id).toBe(1)

  const zlibPath = `/tmp/fogofwalk-pbf-zlib-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(
    zlibPath,
    concatBytes([
      encodeFrame("OSMHeader", encodeRawBlob(header.payload)),
      encodeFrame("OSMData", encodeZlibBlob(data.payload)),
    ])
  )
  const zlibBlocks = []
  for await (const block of iterateOsmPbf(zlibPath)) zlibBlocks.push(block)
  expect(zlibBlocks[0]?.nodes[0]?.lon).toBe(2)

  const truncatedPath = `/tmp/fogofwalk-pbf-truncated-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(truncatedPath, raw.slice(0, -1))
  await expect(async () => {
    for await (const _block of iterateOsmPbf(truncatedPath)) {
      // consume the stream
    }
  }).toThrow("truncated")

  const malformedBlobPath = `/tmp/fogofwalk-pbf-raw-size-${crypto.randomUUID()}.osm.pbf`
  const malformedBlob = new Pbf()
  malformedBlob.writeBytesField(1, data.payload)
  malformedBlob.writeVarintField(2, data.payload.length + 1)
  await Bun.write(
    malformedBlobPath,
    concatBytes([
      encodeFrame("OSMHeader", encodeRawBlob(header.payload)),
      encodeFrame("OSMData", malformedBlob.finish()),
    ])
  )
  await expect(async () => {
    for await (const _block of iterateOsmPbf(malformedBlobPath)) {
      // consume the stream
    }
  }).toThrow("raw_size")
})

test("rejects unsupported required PBF features before consuming data", async () => {
  const header = new Pbf()
  header.writeStringField(4, "OsmSchema-V0.6")
  header.writeStringField(4, "UnsupportedFeature")
  const path = `/tmp/fogofwalk-pbf-feature-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(
    path,
    encodeFrame("OSMHeader", encodeRawBlob(header.finish()))
  )
  await expect(async () => {
    await readOsmPbfHeader(path)
  }).toThrow("unsupported required")
})

function readFrame(
  bytes: Uint8Array,
  offset: number
): { type: string; payload: Uint8Array; nextOffset: number } {
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4
  ).getUint32(0)
  const headerBytes = bytes.slice(offset + 4, offset + 4 + headerLength)
  const header = { type: "", dataSize: 0 }
  new Pbf(headerBytes).readFields((tag, target, reader) => {
    if (tag === 1) target.type = reader.readString()
    else if (tag === 3) target.dataSize = reader.readVarint(true)
    else reader.skip((tag << 3) | reader.type)
  }, header)
  const blobStart = offset + 4 + headerLength
  const blob = bytes.slice(blobStart, blobStart + header.dataSize)
  const decoded = { payload: null as Uint8Array | null }
  new Pbf(blob).readFields((tag, target, reader) => {
    if (tag === 1) target.payload = reader.readBytes()
    else reader.skip((tag << 3) | reader.type)
  }, decoded)
  if (!decoded.payload) throw new Error("test frame has no raw payload")
  return {
    type: header.type,
    payload: decoded.payload,
    nextOffset: blobStart + header.dataSize,
  }
}

function encodeFrame(type: string, blobPayload: Uint8Array): Uint8Array {
  const header = new Pbf()
  header.writeStringField(1, type)
  header.writeVarintField(3, blobPayload.length)
  const headerBytes = header.finish()
  const frame = new Uint8Array(4 + headerBytes.length + blobPayload.length)
  new DataView(frame.buffer).setUint32(0, headerBytes.length)
  frame.set(headerBytes, 4)
  frame.set(blobPayload, 4 + headerBytes.length)
  return frame
}

function encodeRawBlob(payload: Uint8Array): Uint8Array {
  const blob = new Pbf()
  blob.writeBytesField(1, payload)
  return blob.finish()
}

function encodeZlibBlob(payload: Uint8Array): Uint8Array {
  const blob = new Pbf()
  blob.writeBytesField(3, deflateSync(payload))
  blob.writeVarintField(2, payload.length)
  return blob.finish()
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0)
  )
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
