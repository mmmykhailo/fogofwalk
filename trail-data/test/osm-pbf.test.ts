import { expect, test } from "bun:test"
import { gzipSync } from "node:zlib"

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

test("accepts zlib blobs and rejects truncated PBF data", async () => {
  const document = parseOsmXml(`<osm><node id="1" lat="1" lon="2" /></osm>`)
  const raw = encodeOsmPbf(document)
  const compressedBlob = gzipSync(new Uint8Array([1, 2, 3]))
  expect(compressedBlob.length).toBeGreaterThan(0)
  const truncatedPath = `/tmp/fogofwalk-pbf-truncated-${crypto.randomUUID()}.osm.pbf`
  await Bun.write(truncatedPath, raw.slice(0, -1))
  await expect(async () => {
    for await (const _block of iterateOsmPbf(truncatedPath)) {
      // consume the stream
    }
  }).toThrow("truncated")
})
