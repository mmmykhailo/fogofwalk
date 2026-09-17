# Fog of Walk trail archive builder

`trail-data/build.ts` is the only trail build entry point. It is a standalone
Bun/TypeScript release tool: the browser and the deployed Bun server never
parse OSM data or generate trail tiles.

The builder reads explicit local, dated `.osm.pbf` files, verifies their
published checksum and locally calculated SHA-256, then uses a temporary
SQLite index and a z12 tile spool to produce a deterministic schema-v1 PMTiles
archive. The implementation uses only TypeScript/JavaScript and Bun's built-in
SQLite. Its audited data-path packages are `pbf`, `@maplibre/geojson-vt`,
`@maplibre/vt-pbf`, `@mapbox/vector-tile`, and `pmtiles`; none launches an
external process, container, database server, or other generator.

## Offline fixture

The checked-in PBF fixture is generated once from the synthetic XML fixture.
Routine CI uses the local PBF and does not download live OSM or Geofabrik data.
The resulting `fixture` archive is an offline test artifact only: it must stay
under `e2e/fixtures/` and must never be copied into `public/` or a production
static host. The runtime-source guard rejects any `.pmtiles` file under
`public/`.

```sh
bun run build:trail-fixture
bun run verify:trail-fixture
bun test ./trail-data/test/*.test.ts
```

`fixture` also accepts `--write-pbf`, `--output`, `--report`,
`--scratch-dir`, `--keep-scratch`, `--leaf-size`, and
`--force-leaf-directories`. It compares the emitted semantic features and
dropped-overlap count with `fixtures/expected-z12.json` and rewrites the
deterministic local archive.

## Local regional or planet build

Download a dated public OSM PBF before invoking the builder. Approved source
URLs are dated files from the official OSM planet PBF index or public
Geofabrik extracts. The final manifest records the resolved URL; mutable
`latest` names, credentials, query strings, and unapproved hosts are rejected.

Create a manifest with absolute input paths, coverage, snapshot, and the
checksum published by the distributor. MD5 is valid when that is the only
published checksum; the builder independently records SHA-256:

```json
{
  "schemaVersion": 1,
  "coverage": {
    "kind": "regional",
    "bounds": [12.0, 48.5, 19.0, 51.1]
  },
  "snapshot": "2026-09-07T00:00:00Z",
  "inputs": [
    {
      "path": "/data/pbf/czechia-260907.osm.pbf",
      "sourceUrl": "https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf",
      "publishedChecksum": {
        "algorithm": "md5",
        "value": "<published value>"
      },
      "sha256": "<locally calculated sha256>"
    }
  ]
}
```

Run the build from a release machine with scratch space separate from the
archive output when possible:

```sh
bun trail-data/build.ts build \
  --manifest=/data/manifests/czechia.json \
  --output=/data/trails/trails-2026-09-07.pmtiles \
  --report=/data/trails/trails-2026-09-07.report.json \
  --scratch-dir=/data/scratch/fogofwalk-trails
```

The preflight estimates at least twice the declared input size (and never less
than 64 MiB), then requires 25% additional free space. The report records
pass timings, peak RSS, scratch high-water usage, relation/geometry counts,
tile sizes, archive bounds, and provenance. A successful build refuses to
overwrite an existing archive and atomically renames the verified temporary
archive into place. `--keep-scratch` preserves the SQLite/spool directory for
inspection. SIGINT/SIGTERM leave a directory named
`.fogofwalk-trails-incomplete-*`; a partial archive is never renamed to the
requested output.

Production coverage is a measured choice. Run country, continent, and (if
appropriate) planet gates on the documented local machine and record the
results. If planet scale does not fit the measured time, memory, or scratch
budget, publish an explicitly regional manifest and bounds; do not add a
runtime query or another tile generator.

## Verification and publication

Verify the archive independently through the PMTiles reader and MVT decoder:

```sh
bun trail-data/build.ts verify \
  --archive=/data/trails/trails-2026-09-07.pmtiles \
  --checksum=<sha256> \
  --report=/data/trails/trails-2026-09-07.report.json
```

For a release, write the sidecars after reviewing the report:

```sh
bun trail-data/build.ts manifest \
  --archive=/data/trails/trails-2026-09-07-<sha12>.pmtiles \
  --report=/data/trails/trails-2026-09-07.report.json \
  --output-dir=/data/trails
```

This creates the archive checksum, a source/build manifest, and
`*.DATA-LICENSE.txt` containing the ODbL 1.0 and OpenStreetMap attribution
links. Name published archives with the snapshot date and first 12 SHA-256
characters, upload the archive and every sidecar to a temporary static name,
compare remote size/checksum, atomically move to the immutable name, and probe
`HEAD` plus multiple byte ranges from outside the host. Keep the current
archive and at least two predecessors for rollback. Publication is manual and
static; deploy-client only preflights the already-published URL. Run the same
release gate locally after publication:

```sh
bun run check:published-trail \
  --url=https://<host>/map-data/trails/v1/trails-2026-09-07-<sha12>.pmtiles
```

The preflight rejects fixture provenance, mutable input names, non-content-
addressed filenames, missing sidecars, non-206 ranges, missing public CORS,
and non-immutable caching. A blank URL is an explicitly disabled overlay.

The archive contract remains stable: PMTiles v3, gzip MVT, one z12 `trails`
layer, line features only, and exactly `kind`, `color`, `offset`, and `sort`
properties. The static host serves immutable bytes with public CORS and range
support. It does not parse, filter, proxy, refresh, authenticate, or
personalize trail data.
