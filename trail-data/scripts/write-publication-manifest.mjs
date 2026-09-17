import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=")
    return [key, rest.join("=")]
  })
)

function required(name) {
  const value = args.get(name)
  if (!value) throw new Error(`missing --${name}=...`)
  return resolve(value)
}

const archivePath = required("archive")
const reportPath = required("report")
const manifestPath = required("manifest")
const noticePath = required("notice")
const archiveBytes = await readFile(archivePath)
const report = JSON.parse(await readFile(reportPath, "utf8"))
const sha256 = createHash("sha256").update(archiveBytes).digest("hex")
const bytes = archiveBytes.length

if (report.archive?.sha256 && report.archive.sha256 !== sha256) {
  throw new Error("build report archive checksum does not match the archive")
}

report.attribution = "© OpenStreetMap contributors"
report.dataLicense = "ODbL-1.0"
report.metrics ??= {}
for (const [argument, field] of [
  ["peak-resident-memory-bytes", "peakResidentMemoryBytes"],
  ["scratch-disk-high-water-mark-bytes", "scratchDiskHighWaterMarkBytes"],
]) {
  const value = args.get(argument)
  if (value !== undefined) {
    if (!/^\d+$/.test(value)) {
      throw new Error(`--${argument} must be a non-negative integer`)
    }
    report.metrics[field] = Number(value)
  }
}
report.archive = {
  ...report.archive,
  file: basename(archivePath),
  sha256,
  bytes,
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

const manifest = {
  schemaVersion: report.schemaVersion,
  osmSnapshot: report.osmSnapshot,
  osmSourceUrl: report.osmSourceUrl,
  osmSourceChecksum: report.osmSourceChecksum,
  builder: report.builder,
  archive: report.archive,
  attribution: report.attribution,
  dataLicense: report.dataLicense,
  report: basename(reportPath),
  notice: basename(noticePath),
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(
  `${archivePath}.sha256`,
  `${sha256}  ${basename(archivePath)}\n`
)
await writeFile(
  noticePath,
  [
    "Fog of Walk marked trails archive",
    "",
    `Schema version: ${report.schemaVersion}`,
    `OSM snapshot: ${report.osmSnapshot}`,
    `OSM source: ${report.osmSourceUrl}`,
    `OSM source checksum: ${report.osmSourceChecksum}`,
    `Archive: ${basename(archivePath)}`,
    `Archive SHA-256: ${sha256}`,
    "",
    "This archive contains data derived from OpenStreetMap and is distributed",
    "under the Open Database License 1.0 (ODbL-1.0).",
    "Attribution: © OpenStreetMap contributors",
    "https://www.openstreetmap.org/copyright",
    "",
  ].join("\n")
)

console.log(
  JSON.stringify({
    archive: basename(archivePath),
    bytes,
    sha256,
    manifest: basename(manifestPath),
    notice: basename(noticePath),
  })
)
