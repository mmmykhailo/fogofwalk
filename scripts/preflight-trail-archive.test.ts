import { expect, test } from "bun:test"
import { Compression, type Header } from "pmtiles"

import {
  assertBoundsWithinCoverage,
  validateArchiveHeadHeaders,
  validatePublishedTrailManifest,
  validatePublishedTrailUrl,
  validateRangeResponse,
  validateTrailPmtilesHeader,
} from "./preflight-trail-archive"

const filename = "trails-2026-09-07-abcdefabcdef.pmtiles"
const archiveSha256 = `abcdefabcdef${"0".repeat(52)}`

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    coverage: { kind: "regional", bounds: [12, 48.5, 19, 51.1] },
    snapshot: "2026-09-07T00:00:00Z",
    inputs: [
      {
        path: "/data/czech-republic-260907.osm.pbf",
        sourceUrl:
          "https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf",
        publishedChecksum: { algorithm: "md5", value: "a".repeat(32) },
        sha256: "b".repeat(64),
      },
    ],
    archive: { file: filename, bytes: 2101, sha256: archiveSha256 },
    ...overrides,
  }
}

function validHeader(): Header {
  return {
    specVersion: 3,
    tileType: 1,
    tileCompression: Compression.Gzip,
    internalCompression: Compression.Gzip,
    minZoom: 12,
    maxZoom: 12,
    minLon: 14,
    minLat: 50,
    maxLon: 15,
    maxLat: 51,
  } as Header
}

test("accepts a content-addressed regional archive and manifest", () => {
  const url = validatePublishedTrailUrl(
    `https://trails.example.test/map-data/${filename}`
  )
  expect(url?.origin).toBe("https://trails.example.test")
  expect(
    validatePublishedTrailManifest(validManifest(), {
      filename,
      bytes: 2101,
    }).coverage.kind
  ).toBe("regional")
})

test("allows an explicitly disabled archive URL", () => {
  expect(validatePublishedTrailUrl(" ")).toBeNull()
})

test("rejects the fixture filename", () => {
  expect(() =>
    validatePublishedTrailUrl(
      "https://trails.example.test/map-data/trails-v1.pmtiles"
    )
  ).toThrow("fixture")
})

test("rejects fixture provenance", () => {
  expect(() =>
    validatePublishedTrailManifest(validManifest({ snapshot: "fixture" }), {
      filename,
      bytes: 2101,
    })
  ).toThrow("must not be fixture")
})

test("rejects a SHA suffix mismatch", () => {
  expect(() =>
    validatePublishedTrailManifest(
      validManifest({
        archive: {
          file: filename,
          bytes: 2101,
          sha256: `0123456789ab${"0".repeat(52)}`,
        },
      }),
      { filename, bytes: 2101 }
    )
  ).toThrow("does not match the filename")
})

test("rejects a manifest byte-size mismatch", () => {
  expect(() =>
    validatePublishedTrailManifest(validManifest(), {
      filename,
      bytes: 2102,
    })
  ).toThrow("byte size")
})

test("rejects mutable latest input names", () => {
  expect(() =>
    validatePublishedTrailManifest(
      validManifest({
        inputs: [
          {
            ...validManifest().inputs[0],
            path: "/data/czech-republic-latest.osm.pbf",
            sourceUrl:
              "https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf",
          },
        ],
      }),
      { filename, bytes: 2101 }
    )
  ).toThrow()
})

test("rejects absent and non-206 range responses", () => {
  expect(() =>
    validateRangeResponse(200, new Headers(), 127, 0, 126, 2101)
  ).toThrow("expected 206")
  expect(() =>
    validateRangeResponse(
      206,
      new Headers({ "Content-Range": "bytes 0-126/2101" }),
      126,
      0,
      126,
      2101
    )
  ).toThrow("unexpected byte count")
})

test("rejects missing CORS and immutable cache headers", () => {
  const base = {
    "Accept-Ranges": "bytes",
    "Content-Length": "2101",
    "Cache-Control": "public, max-age=31536000, immutable",
  }
  expect(() => validateArchiveHeadHeaders(new Headers(base))).toThrow("CORS")
  expect(() =>
    validateArchiveHeadHeaders(
      new Headers({
        ...base,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public",
      })
    )
  ).toThrow("immutable")
})

test("rejects archive bounds outside declared coverage", () => {
  expect(() =>
    assertBoundsWithinCoverage([11, 48.5, 19, 51.1], [12, 48.5, 19, 51.1])
  ).toThrow("outside declared coverage")
})

test("accepts the required PMTiles header contract", () => {
  expect(() => validateTrailPmtilesHeader(validHeader())).not.toThrow()
  expect(() =>
    validateTrailPmtilesHeader({ ...validHeader(), minZoom: 11 } as Header)
  ).toThrow("z12")
})
