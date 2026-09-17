import { expect, test } from "bun:test"

import {
  normalizeChecksum,
  validateSourceManifest,
  validateSourceUrl,
} from "../src/source-manifest"

test("validates dated keyless source manifests", () => {
  const manifest = validateSourceManifest({
    schemaVersion: 1,
    coverage: {
      kind: "regional",
      bounds: [14, 49, 15, 51],
    },
    snapshot: "2026-09-07T00:00:00Z",
    inputs: [
      {
        path: "/data/czechia-260907.osm.pbf",
        sourceUrl:
          "https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf",
        publishedChecksum: { algorithm: "md5", value: "a".repeat(32) },
        sha256: "b".repeat(64),
      },
    ],
  })
  expect(manifest.inputs[0]?.publishedChecksum).toEqual({
    algorithm: "md5",
    value: "a".repeat(32),
  })
})

test("rejects credentials, mutable names, unapproved hosts, and bad bounds", () => {
  for (const url of [
    "http://download.geofabrik.de/europe/czechia-260907.osm.pbf",
    "https://user:pass@download.geofabrik.de/europe/czechia-260907.osm.pbf",
    "https://download.geofabrik.de/europe/czechia-latest.osm.pbf",
    "https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
    "https://example.test/czechia-260907.osm.pbf",
  ]) {
    expect(() => validateSourceUrl(url)).toThrow()
  }
  expect(() =>
    validateSourceManifest({
      schemaVersion: 1,
      coverage: { kind: "global", bounds: [-180, -85, 180, 85] },
      snapshot: "2026-09-07T00:00:00Z",
      inputs: [],
    })
  ).toThrow()
  expect(normalizeChecksum("sha256", `sha256:${"a".repeat(64)}`)).toBe(
    "a".repeat(64)
  )
})
