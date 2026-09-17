import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"

export const APPROVED_SOURCE_HOSTS = new Set([
  "planet.openstreetmap.org",
  "download.geofabrik.de",
])

export type CoverageKind = "global" | "regional"
export type ChecksumAlgorithm = "md5" | "sha256"
export type Bounds = [number, number, number, number]

export interface PublishedChecksum {
  algorithm: ChecksumAlgorithm
  value: string
}

export interface SourceInput {
  path: string
  sourceUrl: string
  publishedChecksum: PublishedChecksum
  sha256: string
  sizeBytes?: number
}

export interface SourceManifest {
  schemaVersion: 1
  coverage: {
    kind: CoverageKind
    bounds: Bounds
  }
  snapshot: string
  inputs: SourceInput[]
}

export interface VerifiedSourceInput extends SourceInput {
  sizeBytes: number
}

export interface VerifiedSourceManifest extends Omit<SourceManifest, "inputs"> {
  inputs: VerifiedSourceInput[]
}

export async function loadSourceManifest(
  path: string
): Promise<SourceManifest> {
  return validateSourceManifest(JSON.parse(await readFile(path, "utf8")))
}

export function validateSourceManifest(value: unknown): SourceManifest {
  if (!isRecord(value)) throw new Error("source manifest must be a JSON object")
  if (value.schemaVersion !== 1) {
    throw new Error("source manifest schemaVersion must be 1")
  }
  if (!isRecord(value.coverage))
    throw new Error("manifest coverage is required")
  const kind = value.coverage.kind
  if (kind !== "global" && kind !== "regional") {
    throw new Error("manifest coverage.kind must be global or regional")
  }
  const bounds = parseBounds(value.coverage.bounds)
  if (
    kind === "global" &&
    (bounds[0] !== -180 ||
      bounds[1] !== -85.051129 ||
      bounds[2] !== 180 ||
      bounds[3] !== 85.051129)
  ) {
    throw new Error(
      "global manifest coverage must use the full Web Mercator bounds"
    )
  }
  if (
    typeof value.snapshot !== "string" ||
    !value.snapshot ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.snapshot
    ) ||
    !Number.isFinite(Date.parse(value.snapshot))
  ) {
    throw new Error("manifest snapshot must be an ISO timestamp")
  }
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    throw new Error("manifest inputs must contain at least one source file")
  }

  const inputs = value.inputs.map((input, index) =>
    parseSourceInput(input, index)
  )
  return {
    schemaVersion: 1,
    coverage: { kind, bounds },
    snapshot: value.snapshot,
    inputs,
  }
}

export async function verifySourceManifest(
  manifest: SourceManifest
): Promise<VerifiedSourceManifest> {
  const inputs: VerifiedSourceInput[] = []
  for (const input of manifest.inputs) {
    const information = await stat(input.path)
    if (!information.isFile())
      throw new Error(`OSM input is not a file: ${input.path}`)
    const sha256 = await fileDigest(input.path, "sha256")
    if (sha256 !== input.sha256) {
      throw new Error(`OSM input SHA-256 mismatch: ${input.path}`)
    }
    const published =
      input.publishedChecksum.algorithm === "sha256"
        ? sha256
        : await fileDigest(input.path, input.publishedChecksum.algorithm)
    if (published !== input.publishedChecksum.value) {
      throw new Error(`published OSM checksum mismatch: ${input.path}`)
    }
    inputs.push({ ...input, sizeBytes: information.size })
  }
  return { ...manifest, inputs }
}

export async function fileDigest(
  path: string,
  algorithm: ChecksumAlgorithm
): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
  })) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

export function validateSourceUrl(sourceUrl: string): void {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw new Error("OSM source URL must be a public HTTPS URL")
  }
  const fileName = url.pathname.split("/").at(-1) ?? ""
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !APPROVED_SOURCE_HOSTS.has(url.hostname.toLowerCase()) ||
    !fileName.endsWith(".osm.pbf") ||
    /(^|[-_.])latest([-.]|$)/i.test(fileName)
  ) {
    throw new Error("OSM source URL must be a dated public HTTPS .osm.pbf URL")
  }
}

export function normalizeChecksum(
  algorithm: ChecksumAlgorithm,
  value: string
): string {
  const normalized = value.trim().toLowerCase().replace(`${algorithm}:`, "")
  const length = algorithm === "md5" ? 32 : 64
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized)) {
    throw new Error(
      `${algorithm} checksum must contain ${length} hexadecimal characters`
    )
  }
  return normalized
}

function parseSourceInput(value: unknown, index: number): SourceInput {
  if (!isRecord(value))
    throw new Error(`manifest input ${index} must be an object`)
  if (typeof value.path !== "string" || !value.path.startsWith("/")) {
    throw new Error(`manifest input ${index} path must be absolute`)
  }
  const fileName = value.path.split("/").at(-1) ?? ""
  if (
    !fileName.endsWith(".osm.pbf") ||
    /(^|[-_.])latest([-.]|$)/i.test(fileName)
  ) {
    throw new Error(
      `manifest input ${index} path must be a dated .osm.pbf file`
    )
  }
  if (typeof value.sourceUrl !== "string") {
    throw new Error(`manifest input ${index} sourceUrl is required`)
  }
  validateSourceUrl(value.sourceUrl)
  if (!isRecord(value.publishedChecksum)) {
    throw new Error(`manifest input ${index} publishedChecksum is required`)
  }
  const algorithm = value.publishedChecksum.algorithm
  if (algorithm !== "md5" && algorithm !== "sha256") {
    throw new Error(
      `manifest input ${index} checksum algorithm must be md5 or sha256`
    )
  }
  const publishedChecksum = {
    algorithm,
    value: normalizeChecksum(
      algorithm,
      String(value.publishedChecksum.value ?? "")
    ),
  }
  const sha256 = normalizeChecksum("sha256", String(value.sha256 ?? ""))
  return {
    path: value.path,
    sourceUrl: value.sourceUrl,
    publishedChecksum,
    sha256,
  }
}

function parseBounds(value: unknown): Bounds {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((item) => typeof item !== "number")
  ) {
    throw new Error("coverage.bounds must be [minLon, minLat, maxLon, maxLat]")
  }
  const bounds = value as number[]
  if (
    bounds.some((item) => !Number.isFinite(item)) ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -85.051129 ||
    bounds[3] > 85.051129 ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  ) {
    throw new Error(
      "coverage.bounds are outside the supported geographic range"
    )
  }
  return [bounds[0], bounds[1], bounds[2], bounds[3]]
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
