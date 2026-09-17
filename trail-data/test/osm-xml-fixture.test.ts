import { expect, test } from "bun:test"

import { documentEntities, parseOsmXml } from "../src/osm-xml-fixture"

test("parses fixture nodes, way deltas, relation members, and XML escapes", () => {
  const document = parseOsmXml(`
    <osm>
      <node id="1" lat="50.1" lon="14.4" />
      <node id="2" lat="50.2" lon="14.5"><tag k="name" v="A &amp; B" /></node>
      <way id="10"><nd ref="1"/><nd ref="2"/></way>
      <relation id="20">
        <tag k="type" v="route"/><tag k="route" v="hiking"/>
        <member type="way" ref="10" role="forward"/>
      </relation>
    </osm>
  `)
  expect(document.nodes.get(2)?.tags.name).toBe("A & B")
  expect(document.ways.get(10)?.nodeRefs).toEqual([1, 2])
  expect(document.relations.get(20)?.members[0]).toEqual({
    type: "way",
    ref: 10,
    role: "forward",
  })
  expect(
    documentEntities(document).relations.map((relation) => relation.id)
  ).toEqual([20])
})
