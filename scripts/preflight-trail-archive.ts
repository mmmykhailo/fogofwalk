import { gunzipSync } from "node:zlib"

import { Compression, bytesToHeader, type Header } from "pmtiles"

import {
  validateMetadata,
  validateMetadataBounds,
} from "../trail-data/src/verify"
import {
  validateSourceManifest,
  type Bounds,
  type SourceManifest,
} from "../trail-data/src/source-manifest"

const HEADER_BYTES = 127
const ARCHIVE_FILENAME = /^trails-\d{4}-\d{2}-\d{2}-[0-9a-f]{12}\.pmtiles$/
const SHA256 = /^[0-9a-f]{64}$/
const OSM_DATE = /(?:\d{6}|\d{8}|\d{4}-\d{2}-\d{2})/
const BOUNDS_EPSILON = 1e-7

export interface PublishedTrailManifest {
  schemaVersion: 1
  coverage: SourceManifest["coverage"]
  snapshot: string
  inputs: SourceManifest["inputs"]
  archive: {
    file: string
    bytes: number
    sha256: string
  }
}

export interface PublishedTrailSummary {
  origin: string
  filename: string
  schema: 1
  coverage: SourceManifest["coverage"]
  snapshot: string
  bytes: number
  sha256: string
}

export function validatePublishedTrailUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim().length === 0) return null

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error("published trail URL must be an absolute HTTPS URL")
  }
  if (url.protocol !== "https:") {
    throw new Error("published trail URL must use HTTPS")
  }
  if (url.username || url.password) {
    throw new Error("published trail URL must not contain credentials")
  }
  if (url.search || url.hash) {
    throw new Error("published trail URL must not contain a query or fragment")
  }

  const filename = filenameFromUrl(url)
  if (filename === "trails-v1.pmtiles") {
    throw new Error("fixture trail archive filenames are not publishable")
  }
  validateContentAddressedFilename(filename)
  return url
}

export function validateContentAddressedFilename(filename: string): void {
  if (!ARCHIVE_FILENAME.test(filename)) {
    throw new Error(
      "published trail archive filename must be trails-YYYY-MM-DD-<12 lowercase hex>.pmtiles"
    )
  }
}

export function validateArchiveHeadHeaders(headers: Headers): number {
  if (headers.get("accept-ranges")?.trim().toLowerCase() !== "bytes") {
    throw new Error("trail archive must advertise byte ranges")
  }
  const rawLength = headers.get("content-length")
  if (!rawLength || !/^\d+$/.test(rawLength.trim())) {
    throw new Error("trail archive must provide a numeric Content-Length")
  }
  const bytes = Number(rawLength)
  if (!Number.isSafeInteger(bytes) || bytes <= HEADER_BYTES) {
    throw new Error("trail archive Content-Length is invalid")
  }
  if (headers.get("access-control-allow-origin")?.trim() !== "*") {
    throw new Error("trail archive must allow public CORS")
  }
  const cacheControl = headers.get("cache-control")?.toLowerCase() ?? ""
  if (
    !/(^|,)\s*public\s*(?:,|$)/.test(cacheControl) ||
    !/(^|,)\s*immutable\s*(?:,|$)/.test(cacheControl)
  ) {
    throw new Error("trail archive must use public immutable caching")
  }
  return bytes
}

export function validateRangeResponse(
  status: number,
  headers: Headers,
  bodyBytes: number,
  start: number,
  end: number,
  expectedTotal?: number
): number {
  if (status !== 206) {
    throw new Error(`trail archive range returned HTTP ${status}, expected 206`)
  }
  const contentRange = headers.get("content-range")?.trim() ?? ""
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)
  if (!match) {
    throw new Error("trail archive range returned an invalid Content-Range")
  }
  const actualStart = Number(match[1])
  const actualEnd = Number(match[2])
  const total = Number(match[3])
  if (
    actualStart !== start ||
    actualEnd !== end ||
    !Number.isSafeInteger(total) ||
    (expectedTotal !== undefined && total !== expectedTotal)
  ) {
    throw new Error("trail archive range returned an unexpected Content-Range")
  }
  if (bodyBytes !== end - start + 1) {
    throw new Error("trail archive range returned an unexpected byte count")
  }
  return total
}

export function validateTrailPmtilesHeader(header: Header): void {
  if (header.specVersion !== 3 || header.tileType !== 1) {
    throw new Error("trail archive must be PMTiles v3 MVT")
  }
  if (
    header.tileCompression !== Compression.Gzip ||
    header.internalCompression !== Compression.Gzip
  ) {
    throw new Error("trail archive directories and tiles must use gzip")
  }
  if (header.minZoom !== 12 || header.maxZoom !== 12) {
    throw new Error("trail archive must contain z12 tiles only")
  }
  const bounds = [header.minLon, header.minLat, header.maxLon, header.maxLat]
  if (
    bounds.some((value) => !Number.isFinite(value)) ||
    header.minLon < -180 ||
    header.maxLon > 180 ||
    header.minLat < -90 ||
    header.maxLat > 90 ||
    header.minLon >= header.maxLon ||
    header.minLat >= header.maxLat
  ) {
    throw new Error("trail archive bounds must be finite and non-degenerate")
  }
}

export function validatePublishedTrailManifest(
  value: unknown,
  expected: { filename: string; bytes: number }
): PublishedTrailManifest {
  if (!isRecord(value)) {
    throw new Error("published trail manifest must be a JSON object")
  }
  if (value.schemaVersion !== 1) {
    throw new Error("published trail manifest schemaVersion must be 1")
  }
  if (value.snapshot === "fixture") {
    throw new Error("published trail manifest snapshot must not be fixture")
  }

  let sourceManifest: SourceManifest
  try {
    sourceManifest = validateSourceManifest({
      schemaVersion: 1,
      coverage: value.coverage,
      snapshot: value.snapshot,
      inputs: value.inputs,
    })
  } catch (error) {
    throw new Error(
      `published trail manifest provenance is invalid: ${errorMessage(error)}`
    )
  }
  for (const input of sourceManifest.inputs) {
    const sourceFilename = filenameFromUrl(new URL(input.sourceUrl))
    if (!OSM_DATE.test(sourceFilename)) {
      throw new Error("published trail inputs must use dated OSM filenames")
    }
    const localFilename = input.path.split("/").at(-1) ?? ""
    if (!OSM_DATE.test(localFilename)) {
      throw new Error("published trail input paths must use dated filenames")
    }
  }

  if (!isRecord(value.archive)) {
    throw new Error("published trail manifest archive metadata is required")
  }
  if (value.archive.file !== expected.filename) {
    throw new Error("published trail manifest filename does not match the URL")
  }
  if (value.archive.bytes !== expected.bytes) {
    throw new Error(
      "published trail manifest byte size does not match the archive"
    )
  }
  if (
    typeof value.archive.sha256 !== "string" ||
    !SHA256.test(value.archive.sha256)
  ) {
    throw new Error(
      "published trail manifest must contain a 64-character SHA-256"
    )
  }
  const suffix = /-([0-9a-f]{12})\.pmtiles$/.exec(expected.filename)?.[1]
  if (!suffix || value.archive.sha256.slice(0, 12) !== suffix) {
    throw new Error(
      "published trail manifest SHA-256 does not match the filename"
    )
  }

  return {
    schemaVersion: 1,
    coverage: sourceManifest.coverage,
    snapshot: sourceManifest.snapshot,
    inputs: sourceManifest.inputs,
    archive: {
      file: value.archive.file,
      bytes: value.archive.bytes,
      sha256: value.archive.sha256,
    },
  }
}

export function validateChecksumSidecar(
  value: string,
  expectedSha256: string,
  filename: string
): void {
  const match = /^([0-9a-f]{64})\s+\*?([^\s]+)\s*$/.exec(value.trim())
  if (!match || match[1] !== expectedSha256 || match[2] !== filename) {
    throw new Error("trail archive SHA-256 sidecar does not match the manifest")
  }
}

export function assertBoundsWithinCoverage(
  archiveBounds: Bounds,
  coverageBounds: Bounds,
  epsilon = BOUNDS_EPSILON
): void {
  if (
    archiveBounds[0] < coverageBounds[0] - epsilon ||
    archiveBounds[1] < coverageBounds[1] - epsilon ||
    archiveBounds[2] > coverageBounds[2] + epsilon ||
    archiveBounds[3] > coverageBounds[3] + epsilon
  ) {
    throw new Error("trail archive bounds fall outside declared coverage")
  }
}

export async function preflightPublishedTrail(
  rawUrl: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<PublishedTrailSummary | null> {
  const url = validatePublishedTrailUrl(rawUrl)
  if (!url) return null

  const head = await request(fetchImpl, url, { method: "HEAD" }, "HEAD")
  if (!head.ok)
    throw new Error(`trail archive HEAD returned HTTP ${head.status}`)
  const archiveBytes = validateArchiveHeadHeaders(head.headers)
  const filename = filenameFromUrl(url)

  const headerBytes = await fetchRange(
    fetchImpl,
    url,
    0,
    HEADER_BYTES - 1,
    archiveBytes,
    "header"
  )
  let header: Header
  try {
    header = bytesToHeader(headerBytes.buffer as ArrayBuffer)
  } catch {
    throw new Error("trail archive header could not be decoded")
  }
  validateTrailPmtilesHeader(header)
  validateHeaderRanges(header, archiveBytes)

  const manifest = validatePublishedTrailManifest(
    await readJson(fetchImpl, `${url.href}.manifest.json`, "manifest"),
    { filename, bytes: archiveBytes }
  )
  const checksum = await readText(
    fetchImpl,
    `${url.href}.sha256`,
    "checksum sidecar"
  )
  validateChecksumSidecar(checksum, manifest.archive.sha256, filename)

  const metadataBytes = await fetchRange(
    fetchImpl,
    url,
    header.jsonMetadataOffset,
    header.jsonMetadataOffset + header.jsonMetadataLength - 1,
    archiveBytes,
    "metadata"
  )
  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(
      new TextDecoder().decode(gunzipSync(metadataBytes))
    ) as Record<string, unknown>
  } catch {
    throw new Error("trail archive metadata could not be decoded")
  }
  validateMetadata(metadata)
  validateMetadataBounds(metadata, header)
  const vectorLayers = metadata.vector_layers
  const trailLayer = Array.isArray(vectorLayers) ? vectorLayers[0] : null
  if (
    !isRecord(trailLayer) ||
    trailLayer.minzoom !== 12 ||
    trailLayer.maxzoom !== 12
  ) {
    throw new Error("trail archive metadata must declare z12 trails")
  }
  assertBoundsWithinCoverage(
    [header.minLon, header.minLat, header.maxLon, header.maxLat],
    manifest.coverage.bounds
  )

  return {
    origin: url.origin,
    filename,
    schema: 1,
    coverage: manifest.coverage,
    snapshot: manifest.snapshot,
    bytes: archiveBytes,
    sha256: manifest.archive.sha256,
  }
}

export function parseUrlArgument(argv: string[]): string {
  const argument = argv.find((item) => item.startsWith("--url="))
  if (argument) return argument.slice("--url=".length)
  throw new Error("missing --url=<VITE_TRAIL_ARCHIVE_URL>")
}

async function fetchRange(
  fetchImpl: typeof fetch,
  url: URL,
  start: number,
  end: number,
  expectedTotal: number,
  label: string
): Promise<Uint8Array> {
  const response = await request(
    fetchImpl,
    url,
    { headers: { Range: `bytes=${start}-${end}` } },
    `${label} range`
  )
  const body = new Uint8Array(await response.arrayBuffer())
  validateRangeResponse(
    response.status,
    response.headers,
    body.byteLength,
    start,
    end,
    expectedTotal
  )
  return body
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  label: string
): Promise<unknown> {
  const response = await request(fetchImpl, url, undefined, label)
  if (!response.ok)
    throw new Error(`trail archive ${label} returned HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error(`trail archive ${label} is not valid JSON`)
  }
}

async function readText(
  fetchImpl: typeof fetch,
  url: string,
  label: string
): Promise<string> {
  const response = await request(fetchImpl, url, undefined, label)
  if (!response.ok)
    throw new Error(`trail archive ${label} returned HTTP ${response.status}`)
  return response.text()
}

async function request(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit | undefined,
  label: string
): Promise<Response> {
  try {
    return await fetchImpl(input, init)
  } catch {
    throw new Error(`trail archive ${label} request failed`)
  }
}

function validateHeaderRanges(header: Header, archiveBytes: number): void {
  const leafLength = header.leafDirectoryLength ?? 0
  const ranges = [
    [header.rootDirectoryOffset, header.rootDirectoryLength],
    [header.jsonMetadataOffset, header.jsonMetadataLength],
    [header.tileDataOffset, header.tileDataLength ?? 0],
  ]
  if (leafLength > 0) {
    ranges.push([header.leafDirectoryOffset, leafLength])
  }
  for (const [offset, length] of ranges) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > archiveBytes
    ) {
      throw new Error("trail archive header contains an invalid byte range")
    }
  }
}

function filenameFromUrl(url: URL): string {
  return decodeURIComponent(url.pathname.split("/").at(-1) ?? "")
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  preflightPublishedTrail(parseUrlArgument(process.argv.slice(2)))
    .then((summary) => {
      if (!summary) {
        console.log("Trail archive: disabled (schema 1)")
        return
      }
      console.log(JSON.stringify(summary))
    })
    .catch((error: unknown) => {
      console.error(errorMessage(error))
      process.exitCode = 1
    })
}
