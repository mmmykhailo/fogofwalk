import { readFile } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import {
  PMTiles,
  FileSource,
  bytesToHeader,
  readVarint,
  tileIdToZxy,
} from "pmtiles"
import { VectorTile } from "@mapbox/vector-tile"
import Pbf from "pbf"

const PALETTE = new Set([
  "#d9272e",
  "#15803d",
  "#1769aa",
  "#eab308",
  "#ea580c",
  "#7e22ce",
  "#262626",
  "#854d0e",
])
const ALLOWED_PROPERTIES = new Set(["kind", "color", "offset", "sort"])
const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=")
    return [key, rest.join("=")]
  })
)

const archivePath = args.get("archive")
if (!archivePath) throw new Error("missing --archive=/absolute/path.pmtiles")
const bytes = await readFile(archivePath)
const header = bytesToHeader(new Uint8Array(bytes.subarray(0, 127)).buffer)
if (header.specVersion !== 3 || header.tileType !== 1)
  throw new Error("archive must be PMTiles v3 MVT")
if (header.minZoom !== 12 || header.maxZoom !== 12)
  throw new Error("archive must contain z12 tiles only")
if (
  bytes.length > 0 &&
  header.tileDataOffset + header.tileDataLength > bytes.length
)
  throw new Error("tile data exceeds archive")

const file = new File([bytes], archivePath.split("/").pop() ?? "trails.pmtiles")
const archive = new PMTiles(new FileSource(file))
const metadata = await archive.getMetadata()
if (
  !String(metadata.attribution ?? "")
    .toLowerCase()
    .includes("openstreetmap")
)
  throw new Error("missing OpenStreetMap attribution")
const metadataText = JSON.stringify(metadata).toLowerCase()
if (
  !metadataText.includes("odbl-1.0") &&
  !metadataText.includes("open database license")
) {
  throw new Error("missing ODbL-1.0 metadata")
}
const layers = metadata.vector_layers
if (!Array.isArray(layers) || layers.length !== 1 || layers[0]?.id !== "trails")
  throw new Error("source layer must be trails")
const fields = layers[0]?.fields
if (
  !fields ||
  Object.keys(fields).sort().join(",") !== "color,kind,offset,sort"
)
  throw new Error("unexpected trail properties")

const rootStart = header.rootDirectoryOffset
const rootEnd = rootStart + header.rootDirectoryLength
const rootCompressed = bytes.subarray(rootStart, rootEnd)
const root = new Uint8Array(gunzipSync(rootCompressed))
const cursor = { buf: root, pos: 0 }
const entryCount = readVarint(cursor)
const ids = []
let previousId = 0
for (let index = 0; index < entryCount; index++) {
  previousId += readVarint(cursor)
  ids.push(previousId)
}
const runs = Array.from({ length: entryCount }, () => readVarint(cursor))
const lengths = Array.from({ length: entryCount }, () => readVarint(cursor))
const offsets = []
let previousOffset = 0
let previousLength = 0
for (let index = 0; index < entryCount; index++) {
  const encoded = readVarint(cursor)
  const offset =
    encoded === 0 && index > 0 ? previousOffset + previousLength : encoded - 1
  offsets.push(offset)
  previousOffset = offset
  previousLength = lengths[index]
}

let featureCount = 0
for (let index = 0; index < ids.length; index++) {
  if (lengths[index] > 1_048_576)
    throw new Error(`tile ${ids[index]} exceeds 1 MiB compressed`)
  const [zoom, x, y] = tileIdToZxy(ids[index])
  if (zoom !== 12 || runs[index] !== 1)
    throw new Error("unexpected tile directory entry")
  const tile = await archive.getZxy(zoom, x, y)
  if (!tile) throw new Error(`missing tile ${zoom}/${x}/${y}`)
  const vectorTile = new VectorTile(new Pbf(tile.data))
  const layer = vectorTile.layers.trails
  if (!layer) throw new Error(`missing trails layer in ${zoom}/${x}/${y}`)
  for (let featureIndex = 0; featureIndex < layer.length; featureIndex++) {
    const feature = layer.feature(featureIndex)
    if (feature.type !== 2)
      throw new Error("trail archive contains a non-line feature")
    const properties = feature.properties
    if (
      Object.keys(properties).some((key) => !ALLOWED_PROPERTIES.has(key)) ||
      Object.keys(properties).length !== 4
    ) {
      throw new Error("trail feature has unexpected properties")
    }
    if (properties.kind !== "hiking" && properties.kind !== "cycling")
      throw new Error("unknown trail kind")
    if (properties.kind === "hiking" && !PALETTE.has(properties.color))
      throw new Error("invalid hiking color")
    if (properties.kind === "cycling" && properties.color !== "#ec4899")
      throw new Error("invalid cycling color")
    if (
      typeof properties.offset !== "number" ||
      !Number.isFinite(properties.offset)
    )
      throw new Error("invalid trail offset")
    if (
      typeof properties.sort !== "number" ||
      !Number.isInteger(properties.sort) ||
      properties.sort < (properties.kind === "hiking" ? 10 : 20) ||
      properties.sort > (properties.kind === "hiking" ? 14 : 24)
    )
      throw new Error("invalid trail sort")
    featureCount++
  }
}

const expectedChecksum = args.get("checksum")
if (expectedChecksum) {
  const crypto = await import("node:crypto")
  const actual = crypto.createHash("sha256").update(bytes).digest("hex")
  const expected = expectedChecksum.replace(/^sha256:/i, "")
  if (actual !== expected.toLowerCase())
    throw new Error("archive checksum mismatch")
}

if (args.get("report")) {
  const report = JSON.parse(await readFile(args.get("report"), "utf8"))
  report.metrics ??= {}
  report.metrics.tileCount = entryCount
  report.metrics.maxCompressedTileBytes = Math.max(0, ...lengths)
  report.metrics.p50CompressedTileBytes = percentile(lengths, 0.5)
  report.metrics.p95CompressedTileBytes = percentile(lengths, 0.95)
  report.metrics.p99CompressedTileBytes = percentile(lengths, 0.99)
  report.metrics.densestZ12Tiles = ids
    .map((id, index) => ({ id, length: lengths[index] }))
    .sort((a, b) => b.length - a.length)
    .slice(0, 20)
    .map(({ id }) => tileIdToZxy(id).slice(1))
  report.metrics.decodedFeatureCount = featureCount
  const { writeFile } = await import("node:fs/promises")
  await writeFile(args.get("report"), JSON.stringify(report, null, 2) + "\n")
}

console.log(
  JSON.stringify({
    archive: archivePath,
    tiles: entryCount,
    features: featureCount,
  })
)

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
  ]
}
