import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { gzipSync } from "node:zlib"
import { geoJSONToTile } from "@maplibre/geojson-vt"
import { fromGeojsonVt } from "@maplibre/vt-pbf"
import { zxyToTileId } from "pmtiles"

const ZOOM = 12
const EXTENT = 4096
const DEFAULT_INPUT = new URL("../fixtures/marked-routes.osm", import.meta.url)
const DEFAULT_OUTPUT = new URL(
  "../../e2e/fixtures/trails-v1.pmtiles",
  import.meta.url
)
const DEFAULT_EXPECTED = new URL(
  "../fixtures/expected-z12.json",
  import.meta.url
)

const COLORS = {
  red: "#d9272e",
  green: "#15803d",
  blue: "#1769aa",
  yellow: "#eab308",
  orange: "#ea580c",
  purple: "#7e22ce",
  black: "#262626",
  brown: "#854d0e",
}
const COLOR_ORDER = [
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "black",
  "brown",
]
const HIKING_RANKS = { iwn: 4, nwn: 3, rwn: 2, lwn: 1 }
const CYCLING_RANKS = { icn: 4, ncn: 3, rcn: 2, lcn: 1 }

function attrs(source) {
  const result = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    result[match[1]] = match[2]
  }
  return result
}

function tags(source) {
  const result = {}
  for (const match of source.matchAll(/<tag\s+([^>]*?)\/?>(?:\s*<\/tag>)?/g)) {
    const values = attrs(match[1])
    if (values.k !== undefined) result[values.k] = values.v ?? ""
  }
  return result
}

function members(source) {
  return [...source.matchAll(/<member\s+([^>]*?)\/?>(?:\s*<\/member>)?/g)].map(
    (match) => {
      const value = attrs(match[1])
      return {
        type: value.type,
        ref: Number(value.ref),
        role: value.role ?? "",
      }
    }
  )
}

function parseOsm(xml) {
  const nodes = new Map()
  for (const match of xml.matchAll(
    /<node\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g
  )) {
    const value = attrs(match[1])
    nodes.set(Number(value.id), [Number(value.lon), Number(value.lat)])
  }

  const ways = new Map()
  for (const match of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const value = attrs(match[1])
    const refs = [
      ...match[2].matchAll(/<nd\s+([^>]*?)\/?>(?:\s*<\/nd>)?/g),
    ].map((nd) => Number(attrs(nd[1]).ref))
    ways.set(Number(value.id), { nodes: refs })
  }

  const relations = new Map()
  for (const match of xml.matchAll(
    /<relation\s+([^>]*?)>([\s\S]*?)<\/relation>/g
  )) {
    const value = attrs(match[1])
    relations.set(Number(value.id), {
      tags: tags(match[2]),
      members: members(match[2]),
    })
  }
  return { nodes, ways, relations }
}

function normalizeColor(relationTags) {
  let raw
  if (Object.hasOwn(relationTags, "osmc:symbol")) {
    raw = String(relationTags["osmc:symbol"]).trim().split(":", 1)[0]
  } else if (Object.hasOwn(relationTags, "colour")) {
    raw = relationTags.colour
  } else if (Object.hasOwn(relationTags, "color")) {
    raw = relationTags.color
  } else {
    return { color: COLORS.purple, unsupported: false }
  }
  const token = String(raw ?? "")
    .trim()
    .toLowerCase()
  return {
    color: COLORS[token] ?? COLORS.purple,
    unsupported: COLORS[token] === undefined,
  }
}

function classify(id, relationTags) {
  if (relationTags.type !== "route" && relationTags.type !== "superroute")
    return null
  const kind =
    relationTags.route === "bicycle"
      ? "cycling"
      : relationTags.route === "hiking" || relationTags.route === "foot"
        ? "hiking"
        : null
  if (!kind) return null
  const color =
    kind === "cycling" ? "#ec4899" : normalizeColor(relationTags).color
  const rank =
    (kind === "hiking" ? HIKING_RANKS : CYCLING_RANKS)[relationTags.network] ??
    0
  return {
    id,
    kind,
    rank,
    color,
    superroute: relationTags.type === "superroute",
  }
}

function visualFeatures(memberships) {
  const byKey = new Map()
  for (const membership of memberships) {
    const key =
      membership.kind === "hiking"
        ? `${membership.kind}:${membership.color}`
        : membership.kind
    const previous = byKey.get(key)
    if (
      !previous ||
      membership.rank > previous.rank ||
      (membership.rank === previous.rank && membership.id < previous.id)
    ) {
      byKey.set(key, membership)
    }
  }
  const hiking = [...byKey.values()]
    .filter((membership) => membership.kind === "hiking")
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        COLOR_ORDER.indexOf(a.colorName) - COLOR_ORDER.indexOf(b.colorName) ||
        a.id - b.id
    )
  const cycling = [...byKey.values()].find(
    (membership) => membership.kind === "cycling"
  )
  const dropped = Math.max(0, hiking.length - 4)
  const selected = hiking.slice(0, 4)
  const result = selected.map((membership, index) => ({
    ...membership,
    offset: (index - (selected.length - 1) / 2) * 3,
    sort: 10 + membership.rank,
  }))
  if (cycling)
    result.push({
      ...cycling,
      offset: 0,
      sort: 20 + cycling.rank,
      color: "#ec4899",
    })
  return { features: result, dropped }
}

function tileForCoordinate([lng, lat]) {
  const n = 2 ** ZOOM
  const x = Math.floor(((lng + 180) / 360) * n)
  const radians = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * n)
  return { x, y }
}

function selectFeatures(osm) {
  const accepted = new Map()
  for (const [id, relation] of osm.relations) {
    const classification = classify(id, relation.tags)
    if (classification) accepted.set(id, { ...classification, relation })
  }

  const membershipsByWay = new Map()
  function walkRelation(relationId, membership, visited) {
    if (visited.has(relationId)) return
    visited.add(relationId)
    const relation = osm.relations.get(relationId)
    if (!relation) return
    for (const member of relation.members) {
      if (member.type === "way") {
        const list = membershipsByWay.get(member.ref) ?? []
        list.push(membership)
        membershipsByWay.set(member.ref, list)
      } else if (member.type === "relation") {
        walkRelation(member.ref, membership, new Set(visited))
      }
    }
  }
  for (const [id, classification] of accepted)
    walkRelation(id, classification, new Set())

  const features = []
  let dropped = 0
  for (const [wayId, memberships] of membershipsByWay) {
    const way = osm.ways.get(wayId)
    if (!way || way.nodes.length < 2) continue
    const coordinates = way.nodes
      .map((nodeId) => osm.nodes.get(nodeId))
      .filter(Boolean)
    if (coordinates.length !== way.nodes.length || coordinates.length < 2)
      continue
    const normalized = memberships.map((membership) => ({
      id: membership.id,
      kind: membership.kind,
      rank: membership.rank,
      color: membership.color,
      colorName:
        COLOR_ORDER.find((name) => COLORS[name] === membership.color) ??
        "purple",
    }))
    const selected = visualFeatures(normalized)
    dropped += selected.dropped
    for (const visual of selected.features) {
      features.push({
        type: "Feature",
        id: wayId * 100 + features.length,
        properties: {
          kind: visual.kind,
          color: visual.color,
          offset: visual.offset,
          sort: visual.sort,
        },
        geometry: { type: "LineString", coordinates },
        wayId,
      })
    }
  }
  return { features, dropped }
}

function varint(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid varint ${value}`)
  const result = []
  while (value >= 128) {
    result.push((value % 128) + 128)
    value = Math.floor(value / 128)
  }
  result.push(value)
  return Uint8Array.from(result)
}

function encodeDirectory(entries) {
  const chunks = [varint(entries.length)]
  let previousId = 0
  for (const entry of entries) {
    chunks.push(varint(entry.tileId - previousId))
    previousId = entry.tileId
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

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function uint64(view, offset, value) {
  view.setUint32(offset, value % 2 ** 32, true)
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true)
}

function int32(view, offset, value) {
  view.setInt32(offset, Math.round(value * 10_000_000), true)
}

function writeHeader({ root, metadata, tileData, entries, bounds, center }) {
  const header = new Uint8Array(127)
  header.set(new TextEncoder().encode("PMTiles"), 0)
  const view = new DataView(header.buffer)
  view.setUint8(7, 3)
  const rootOffset = 127
  const metadataOffset = rootOffset + root.length
  const tileOffset = metadataOffset + metadata.length
  uint64(view, 8, rootOffset)
  uint64(view, 16, root.length)
  uint64(view, 24, metadataOffset)
  uint64(view, 32, metadata.length)
  uint64(view, 40, 0)
  uint64(view, 48, 0)
  uint64(view, 56, tileOffset)
  uint64(view, 64, tileData.length)
  uint64(
    view,
    72,
    entries.reduce((sum, entry) => sum + entry.runLength, 0)
  )
  uint64(view, 80, entries.length)
  uint64(view, 88, entries.length)
  view.setUint8(96, 1)
  view.setUint8(97, 2)
  view.setUint8(98, 2)
  view.setUint8(99, 1)
  view.setUint8(100, ZOOM)
  view.setUint8(101, ZOOM)
  int32(view, 102, bounds.minLon)
  int32(view, 106, bounds.minLat)
  int32(view, 110, bounds.maxLon)
  int32(view, 114, bounds.maxLat)
  view.setUint8(118, ZOOM)
  int32(view, 119, center[0])
  int32(view, 123, center[1])
  return header
}

async function build(inputPath, outputPath, expectedPath) {
  const xml = await readFile(inputPath, "utf8")
  const osm = parseOsm(xml)
  const selected = selectFeatures(osm)
  const geojson = {
    type: "FeatureCollection",
    features: selected.features.map(({ wayId, ...feature }) => feature),
  }
  const candidateTiles = new Set()
  for (const feature of selected.features) {
    for (const coordinate of feature.geometry.coordinates) {
      const tile = tileForCoordinate(coordinate)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++)
          candidateTiles.add(`${tile.x + dx},${tile.y + dy}`)
      }
    }
  }

  const tileRecords = []
  for (const key of candidateTiles) {
    const [x, y] = key.split(",").map(Number)
    if (x < 0 || y < 0 || x >= 2 ** ZOOM || y >= 2 ** ZOOM) continue
    const tile = geoJSONToTile(geojson, ZOOM, x, y, {
      extent: EXTENT,
      maxZoom: ZOOM,
      tolerance: 0,
      buffer: 64,
      clip: true,
      wrap: false,
    })
    if (!tile.features.length) continue
    const pbf = fromGeojsonVt({ trails: tile }, { version: 2, extent: EXTENT })
    const compressed = gzipSync(pbf)
    tileRecords.push({
      x,
      y,
      tileId: zxyToTileId(ZOOM, x, y),
      bytes: compressed,
    })
  }
  tileRecords.sort((a, b) => a.tileId - b.tileId)
  const entries = []
  let tileOffset = 0
  const tileChunks = []
  for (const record of tileRecords) {
    entries.push({
      tileId: record.tileId,
      offset: tileOffset,
      length: record.bytes.length,
      runLength: 1,
    })
    tileChunks.push(record.bytes)
    tileOffset += record.bytes.length
  }

  const root = gzipSync(encodeDirectory(entries))
  const metadata = gzipSync(
    Buffer.from(
      JSON.stringify({
        tilejson: "3.0.0",
        name: "Fog of Walk marked trails fixture",
        version: "1",
        format: "pbf",
        attribution: "© OpenStreetMap contributors",
        license: "ODbL-1.0",
        dataLicense: "ODbL-1.0",
        description:
          "Synthetic OSM route-relation fixture for Fog of Walk trail schema v1",
        vector_layers: [
          {
            id: "trails",
            description: "OSM route relation members",
            minzoom: ZOOM,
            maxzoom: ZOOM,
            fields: {
              kind: "String",
              color: "String",
              offset: "Number",
              sort: "Number",
            },
          },
        ],
      })
    )
  )
  const bounds = selected.features
    .flatMap((feature) => feature.geometry.coordinates)
    .reduce(
      (result, [lon, lat]) => ({
        minLon: Math.min(result.minLon, lon),
        minLat: Math.min(result.minLat, lat),
        maxLon: Math.max(result.maxLon, lon),
        maxLat: Math.max(result.maxLat, lat),
      }),
      {
        minLon: Infinity,
        minLat: Infinity,
        maxLon: -Infinity,
        maxLat: -Infinity,
      }
    )
  const center = [14.42, 50.11]
  const header = writeHeader({
    root,
    metadata,
    tileData: concat(tileChunks),
    entries,
    bounds,
    center,
  })
  const archive = concat([header, root, metadata, concat(tileChunks)])
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, archive)
  await writeFile(
    expectedPath,
    await readFile(new URL("../fixtures/expected-z12.json", import.meta.url))
  )
  console.log(
    `built ${outputPath} (${archive.length} bytes, ${tileRecords.length} tiles, ${selected.features.length} features)`
  )
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=")
    return [key, rest.join("=")]
  })
)
const inputPath = resolve(args.get("input") ?? fileURLToPath(DEFAULT_INPUT))
const outputPath = resolve(args.get("output") ?? fileURLToPath(DEFAULT_OUTPUT))
const expectedPath = resolve(
  args.get("expected") ?? fileURLToPath(DEFAULT_EXPECTED)
)

function fileURLToPath(url) {
  return decodeURIComponent(new URL(url).pathname)
}

await build(inputPath, outputPath, expectedPath)
