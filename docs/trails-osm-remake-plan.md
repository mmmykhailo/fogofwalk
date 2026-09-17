# TypeScript-only OSM trails migration plan

## Follow-up status

The TypeScript builder, fixture pipeline, static browser contract, and offline
verification described by this migration plan are complete. The checked-in
fixture remains test-only and is not production trail data. Real dated Czechia
publication, immutable-host activation, and the clean-session activation
investigation are tracked in [the real-data fix plan](trails-real-data-fix-plan.md);
that plan is the source of truth for the remaining release operation and its
preflight gates.

## Status and decision

This plan supersedes the implemented Planetiler/Java trail-data pipeline.

Keep the parts of the current implementation that already fit the product:

- marked hiking and cycling routes derived from OpenStreetMap;
- one immutable PMTiles archive read directly by MapLibre in the browser;
- the existing trail toggle, layer order, failure isolation, and attribution;
- static byte-range hosting that does not involve the optional Bun sync server.

Replace the complete archive-generation toolchain with a standalone,
bounded-memory Bun/TypeScript program. Production archives may be generated
locally as a release operation, but trail processing must never become a
server endpoint, background server job, or client-side OSM query.

The repository must contain no Java source, JVM build, Gradle wrapper, Kotlin
build file, JAR, or Planetiler dependency after the migration. Trail tooling
must also not shell out to Planetiler, Osmium, Tippecanoe, tilemaker, Docker, a
database server, or another non-TypeScript generator. Bun is the only required
executable. Bun's built-in SQLite and normal JavaScript/TypeScript packages are
allowed implementation libraries; they do not add a separately operated
service.

Production source data will be a dated OpenStreetMap PBF snapshot downloaded
from a public, keyless source. The first choice is the official dated planet
PBF. Public Geofabrik regional or continental PBF extracts are allowed for
development, feasibility measurements, and an explicitly regional release.
No account, API key, access token, operator approval, or paid dataset may be
required to obtain the source.

The current PMTiles archive is not evidence that a planet-scale pure
TypeScript build is practical. A measured full-build gate is therefore part of
the migration. If it fails, the permitted fallback is clearly declared
regional coverage built from dated Geofabrik extracts. It is not permissible
to restore Java, call a public query API, or silently substitute an
undocumented tile service.

## Non-negotiable constraints

1. Trail data comes from OpenStreetMap or another reviewed open dataset whose
   redistribution terms are compatible with the published archive.
2. Source downloads require no login, API key, token, registration, or prior
   permission.
3. No trail-specific application code runs in server/ or in the deployed Bun
   server. Static web-server configuration may serve immutable archive bytes.
4. Archive generation is an explicit local release task, not a request-time,
   scheduled server, or browser operation.
5. All trail build, verification, manifest, and fixture source files are
   TypeScript.
6. A normal client build does not download or regenerate trail data.
7. An unset trail archive URL leaves the browser-first application fully
   usable and hides the trail control.
8. VITE_API_URL remains unrelated to trail availability.
9. A data-source failure disables only trails. It must not affect activity
   import, fog, photos, saved points, statistics, or optional sync.
10. Licence obligations and attribution still apply even though the data is
    free and keyless.

## Outcome

After this work:

- no Java, Gradle, Kotlin, wrapper, JAR, or Planetiler file remains in
  trail-data/;
- package and workflow configuration contains no JVM setup or Maven/Gradle
  dependency;
- bun trail-data/build.ts is the only trail tool entry point;
- the tool can build and verify the checked-in fixture without network access;
- the tool can build a regional archive from an explicit local .osm.pbf;
- a production archive is built locally from recorded dated inputs, or the
  release explicitly declares its regional bounds;
- the browser continues to request only immutable PMTiles byte ranges;
- the optional sync server never parses OSM, generates tiles, proxies a trail
  provider, stores trail data, or chooses an archive;
- every published archive has a checksum, source manifest, build report,
  attribution, licence notice, and declared geographic coverage;
- all active build documentation describes the TypeScript toolchain;
  Planetiler and Java appear only in migration history and removal checks.

## Current implementation audit

### Keep

The following implemented pieces already match the target architecture and
should be changed only where tests or terminology require it:

- app/lib/map/trails/config.ts validates an optional immutable archive URL;
- app/lib/map/trails/layers.ts creates one PMTiles vector source and three
  presentation layers;
- app/lib/map/styles.ts registers the PMTiles protocol in the browser;
- the map lifecycle and presentation hooks add resources only when enabled and
  at the supported zoom;
- app/sw.ts excludes trail range responses from whole-response caching;
- e2e/fixtures/trails-pmtiles.ts serves exact local range responses;
- e2e/specs/trails.spec.ts covers rendering, ordering, failures, and request
  suppression;
- scripts/check-trail-runtime-sources.ts rejects public API fallbacks;
- the client deploy checks HEAD and Range behavior before compiling an archive
  URL;
- static hosting returns immutable, public, range-capable files.

### Replace

The current production builder is Java 21 with Planetiler and Gradle. The shell
scripts, workflow, report, documentation, and tests are coupled to that stack.
They must be replaced together rather than leaving a second, undocumented
build path.

The existing TypeScript fixture generator is useful as a semantic oracle, but
it is not a production builder. It reads the complete XML fixture and writes
the complete archive in memory, emits only a single PMTiles root directory,
and does not implement a streaming PBF or planet-scale tile spool. Reusing it
unchanged for a real extract would create false confidence.

## Source policy

### Approved sources

Production and development inputs are limited to:

- dated official OpenStreetMap planet PBF files from
  https://planet.openstreetmap.org/pbf/;
- public Geofabrik .osm.pbf extracts from
  https://download.geofabrik.de/ for regional development and, if explicitly
  declared, regional production coverage;
- the synthetic OSM XML/PBF fixtures committed in trail-data/fixtures.

Geofabrik documents its public extracts as pure, unfiltered OSM data, available
without login, and publishes a stable JSON index of extract URLs. The release
process may use that index to locate a file, but the final input manifest must
record the resolved dated URL rather than a mutable latest URL.

The maintainer downloads source files before invoking the builder. The builder
accepts local paths and never needs source credentials. A future download
helper may be added as a subcommand only if it resolves public URLs, records
the final URL and response metadata, and performs no authenticated request.

### Source manifest

Every non-fixture build starts from a reviewed JSON manifest:

```json
{
  "schemaVersion": 1,
  "coverage": {
    "kind": "global",
    "bounds": [-180, -85.051129, 180, 85.051129]
  },
  "snapshot": "2026-09-07T00:00:00Z",
  "inputs": [
    {
      "path": "/absolute/path/planet-260907.osm.pbf",
      "sourceUrl": "https://planet.openstreetmap.org/pbf/planet-260907.osm.pbf",
      "publishedChecksum": {
        "algorithm": "md5",
        "value": "<published value>"
      },
      "sha256": "<locally calculated sha256>"
    }
  ]
}
```

The published checksum algorithm is recorded as supplied by the distributor;
the plan must not claim a published SHA-256 when the distributor publishes
only MD5. Independently calculate and record SHA-256 for every local input and
generated output.

For a multi-extract regional build, list every extract and record the intended
union bounds. Input paths must be absolute. Mutable latest filenames are not
eligible for publication unless copied to an immutable local name and paired
with retrieval time, resolved response URL, size, and calculated SHA-256.

### Rejected sources and paths

| Source or approach                                        | Reason                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waymarked Trails endpoints                                | Volunteer service and provider-specific, undocumented runtime contract.                                                                            |
| Public Overpass instances                                 | Shared query services are not production tile backends or release-scale extract services.                                                          |
| OpenStreetMap editing API                                 | Intended for editing and small element access, not bulk display data.                                                                              |
| tile.openstreetmap.org                                    | Rendered tiles do not expose relation data and bulk use is prohibited.                                                                             |
| A provider that merely works without a key                | Keyless access alone does not establish an open licence or stable reuse terms.                                                                     |
| Browser-side PBF processing                               | Repeats expensive relation assembly for every user and breaks bounded offline behavior.                                                            |
| OpenFreeMap tiles as a trail build input                  | They are a basemap service, not the canonical trail dataset, and their schema does not preserve the complete route contract required here.         |
| Overture transportation data                              | It is useful open transportation data, but it is not a drop-in source for the OSM route tags and color semantics already promised by this feature. |
| Native or JVM tile generators behind a TypeScript wrapper | The implementation would not actually be TypeScript-only.                                                                                          |

OpenFreeMap remains the existing flat basemap. This plan does not add a new
runtime request to it for the trail overlay.

## Target architecture

```text
dated public OSM PBF file(s) + checksums
                    |
                    v
        local Bun/TypeScript release tool
   streaming PBF decode + disk-backed relation joins
    deterministic classification + z12 tile spool
                    |
                    v
 immutable trails-<date>-<sha12>.pmtiles
       report + manifest + checksum + licence
                    |
                    v
       public static range-capable file host
          (no application server code)
                    |
                    v
       browser PMTiles protocol + MapLibre
                    |
                    v
       trails below fog and activity overlays
```

The static host serves bytes only. It does not parse, filter, proxy, refresh,
authenticate, or personalize trail data. The same archive can be placed on a
different static origin without changing application code.

## Trail archive contract

Preserve schema version 1 unless the TypeScript prototype proves that a schema
change is necessary:

- PMTiles v3;
- gzip-compressed Mapbox Vector Tiles;
- one source layer named trails;
- line features only;
- data at z12, overzoomed by MapLibre above z12;
- properties limited to kind, color, offset, and sort;
- kind is hiking or cycling;
- immutable content-addressed filename;
- explicit bounds in PMTiles metadata and the publication manifest;
- visible OpenStreetMap attribution and ODbL metadata.

```ts
interface TrailTilePropertiesV1 {
  kind: "hiking" | "cycling"
  color: string
  offset: number
  sort: number
}
```

Keep the implemented classification rules as the initial parity target:

- accept type=route and type=superroute;
- accept route=hiking and route=foot as hiking;
- accept route=bicycle as cycling;
- rank iwn/icn above nwn/ncn, rwn/rcn, lwn/lcn, then unknown;
- derive hiking color from the first osmc:symbol component, then colour, then
  color, then the neutral fallback;
- keep the closed color palette and fixed cycling color;
- deduplicate equivalent visual memberships;
- keep at most four hiking colors per way, center their offsets, and emit at
  most one cycling feature;
- protect against cyclic or repeated superroute membership;
- count invalid geometry, unsupported color, duplicate source objects, and
  dropped overlap keys.

The TypeScript migration is not the place to redesign route semantics. Any
semantic change must first update the fixture expectations and increment the
schema if shipped properties or interpretation become incompatible.

## TypeScript builder design

### One entry point

Use one visible entry point with subcommands:

```text
bun trail-data/build.ts fixture
bun trail-data/build.ts build --manifest=/absolute/input.json --output=/absolute/trails.pmtiles
bun trail-data/build.ts verify --archive=/absolute/trails.pmtiles
bun trail-data/build.ts manifest --archive=... --report=... --output-dir=...
```

All implementation modules live under trail-data/src/ and all tests under
trail-data/test/. There are no shell wrappers. package.json may provide short
aliases, but those aliases invoke the TypeScript entry point directly.

Proposed structure:

```text
trail-data/
  README.md
  build.ts
  fixtures/
    marked-routes.osm
    marked-routes.osm.pbf
    expected-z12.json
  src/
    arguments.ts
    source-manifest.ts
    osm-pbf.ts
    osm-xml-fixture.ts
    relation-graph.ts
    classifier.ts
    build-store.ts
    geometry.ts
    tile-spool.ts
    mvt.ts
    pmtiles-writer.ts
    verify.ts
    report.ts
    publication.ts
  test/
    osm-pbf.test.ts
    relation-graph.test.ts
    classifier.test.ts
    tile-spool.test.ts
    pmtiles-writer.test.ts
    fixture.test.ts
```

### Dependency rule

Prefer the packages already present for MVT and PMTiles tests:

- pbf for protobuf primitives;
- @maplibre/geojson-vt for tested z12 clipping in bounded per-tile batches;
- @maplibre/vt-pbf for MVT encoding;
- @mapbox/vector-tile for verification;
- pmtiles for tile-ID conversion and independent reading;
- Bun's built-in SQLite for the temporary build index.

Do not add a dependency merely because it has a TypeScript declaration. Before
adopting a PBF or tile writer library, verify that its implementation is
JavaScript/TypeScript, that it streams from a file instead of buffering the
whole input, and that it does not download or execute a native/JVM binary.
Record this audit in trail-data/README.md.

The safest baseline is a small repository-owned TypeScript PBF reader using
pbf plus node:zlib. It needs only the OSMHeader and OSMData fields used by this
builder. It must decode dense-node deltas, way node-reference deltas, relation
member deltas and roles, string tables, granularity, and coordinate offsets.
Unknown protobuf fields are skipped. PBF conformance is tested against the
synthetic fixture and at least two independently produced public regional
extracts.

### Bounded-memory passes

The builder uses a temporary SQLite database inside a caller-selected scratch
directory. SQLite is an offline implementation detail and is deleted after a
successful build unless --keep-scratch is set. It is never a runtime or server
database.

Use explicit passes:

1. Preflight
   - validate the manifest, paths, coverage, schema, and output non-existence;
   - verify each published checksum and calculated SHA-256;
   - inspect PBF headers and reject unsupported required features;
   - estimate scratch space and refuse to start below the configured headroom.
2. Relation scan
   - stream relation blocks only;
   - store accepted relations, relation-to-way members, and relation-to-relation
     edges;
   - use OSM IDs and versions as stable keys across multiple extracts.
3. Relation resolution
   - resolve direct and inherited memberships with an iterative graph walk;
   - terminate cycles, deduplicate paths, and write the selected visual
     memberships for each way into indexed tables.
4. Way scan
   - stream ways and retain only IDs present in the membership table;
   - store ordered node references once per selected way;
   - detect conflicting duplicates across extracts and use the highest OSM
     version only when content is otherwise valid and deterministic.
5. Node scan
   - stream dense and regular nodes;
   - retain coordinates only for node IDs referenced by selected ways;
   - batch lookups and inserts per PBF primitive block; never issue a new
     transaction for every planet node.
6. Geometry assembly
   - join each selected way to its ordered coordinates;
   - count and skip missing or malformed geometry;
   - classify memberships once and produce the minimal visual features.
7. Tile spool
   - project each way to Web Mercator, determine intersecting z12 tiles, and
     write features to a disk-backed tile spool keyed by Hilbert tile ID;
   - use a uniqueness key based on way ID and visual key so overlapping
     Geofabrik extracts cannot duplicate a rendered line;
   - clip and simplify only when a single tile batch is read.
8. MVT encoding
   - encode one tile at a time in tile-ID order;
   - gzip it immediately and write it to a temporary tile-data file;
   - record offset, compressed length, feature count, and validation metrics;
   - never retain all features or all encoded tiles in memory.
9. PMTiles packing
   - implement PMTiles v3 root and leaf directories, not the fixture-only
     single-root shortcut;
   - stream the sorted tile-data file into the final archive;
   - write metadata, bounds, center, counts, compression modes, and directory
     offsets according to the PMTiles specification;
   - fsync and atomically rename only after verification succeeds.
10. Independent verification
    - reopen the completed archive through the pmtiles reader;
    - decode every fixture tile and sampled/dense production tiles with
      @mapbox/vector-tile;
    - compare directory counts, metadata, schema, checksums, and report totals.

Every pass records elapsed time, peak process RSS, scratch bytes, rows read,
rows retained, and failures. The process must respond to SIGINT/SIGTERM by
closing SQLite and leaving only a clearly named incomplete scratch directory;
it must never rename a partial archive to the requested output.

### Reproducibility

For the same ordered manifest, builder version, and Bun/package lock:

- relation and visual keys use explicit stable sort orders;
- SQL queries that affect output include ORDER BY;
- object or Map insertion order is never used as an implicit tie-breaker;
- gzip uses fixed metadata;
- timestamps do not enter MVT or PMTiles bytes;
- the report records wall-clock information, but the archive does not;
- fixture builds are byte-for-byte deterministic;
- regional and planet builds should be deterministic, with a documented
  semantic fallback if a platform gzip implementation prevents binary parity.

## Build report and release gates

The report retains the existing provenance fields and adds TypeScript-specific
measurements:

```json
{
  "schemaVersion": 1,
  "coverage": {
    "kind": "global",
    "bounds": [-180, -85.051129, 180, 85.051129]
  },
  "snapshot": "2026-09-07T00:00:00Z",
  "builder": {
    "name": "fogofwalk-trails",
    "language": "typescript",
    "bunVersion": "<version>",
    "gitCommit": "<commit>"
  },
  "inputs": [],
  "archive": {
    "file": "trails-2026-09-07-<sha12>.pmtiles",
    "sha256": "<sha256>",
    "bytes": 0,
    "minzoom": 12,
    "maxzoom": 12
  },
  "counts": {},
  "metrics": {}
}
```

Required counts include accepted relations by kind, superroutes, relation
cycles, relation members, unique member ways, emitted ways/features, missing
nodes, invalid geometries, unsupported colors, duplicate source objects,
source conflicts, overlap-cap ways, dropped keys, tiles, and decoded
verification features.

Release gates:

- no source checksum mismatch;
- no unsupported required PBF feature;
- no unresolved duplicate conflict;
- no PMTiles or MVT schema error;
- overlap-cap ways at or below 0.1% of emitted ways;
- no compressed tile over 1 MiB;
- a normal measured viewport at or below 2 MiB of trail tile data;
- current archive plus two rollback archives fit with at least 25% static-host
  disk headroom;
- the archive passes representative samples on every covered continent;
- the local build completes within the release machine's recorded time,
  memory, and scratch budgets.

Do not invent a planet hardware estimate from Planetiler documentation. Measure
the TypeScript implementation on the fixture, one country, one continent, and
then the planet. Record each result.

## Hosting and runtime boundary

The generated archive and sidecars are static release artifacts. Serving them
with Caddy or another static object host is acceptable; adding a Bun route,
worker, queue, database table, proxy, or scheduled refresh is not.

The current Caddy range handler may remain because it only serves immutable
files. Audit it to ensure:

- only public GET, HEAD, and required OPTIONS behavior;
- byte-range support and correct 206/Content-Range;
- public CORS suitable for an immutable data archive;
- no directory listing;
- no fallback to the Bun reverse proxy;
- no authenticated or signed archive URL;
- immutable cache headers for content-addressed names.

server/ must contain no trail parser, builder, downloader, refresh job,
application route, or persistence code. The provision script may create the
static directory, but the Bun service account must not write it.

Publication is manual:

1. Run the local TypeScript fixture tests.
2. Build the dated archive locally.
3. Verify it locally and review the report.
4. Name it with the snapshot date and first 12 SHA-256 characters.
5. Upload the archive and sidecars to a temporary static filename.
6. Compare remote size and SHA-256 with the local files.
7. Atomically move the files to their immutable names.
8. Probe HEAD and several byte ranges from outside the host.
9. Update VITE_TRAIL_ARCHIVE_URL and make the normal client release.

The source archive is never rebuilt or downloaded by deploy-client.yml.
Client deployment only preflights the already published URL.

## Exact repository changes

### Delete

Remove all Java/JVM and wrapper files:

```text
trail-data/build.gradle.kts
trail-data/gradle.properties
trail-data/settings.gradle.kts
trail-data/versions.properties
trail-data/gradlew
trail-data/gradle/
trail-data/src/main/java/
trail-data/src/test/java/
```

Remove shell and Java-specific entry points:

```text
trail-data/scripts/build-fixture.sh
trail-data/scripts/build-region.sh
trail-data/scripts/build-planet.sh
trail-data/scripts/verify-archive.sh
```

After their behavior is moved into TypeScript, remove or rename:

```text
trail-data/scripts/build-fixture.mjs
trail-data/scripts/verify-archive.mjs
trail-data/scripts/write-publication-manifest.mjs
```

### Create

Create the TypeScript structure described under One entry point, including:

- a streaming PBF reader;
- a disk-backed build store;
- the migrated classifier and relation graph;
- a bounded tile spool;
- a production PMTiles v3 writer with leaf-directory coverage;
- archive and publication verification;
- TypeScript unit and integration tests;
- a small deterministic .osm.pbf fixture generated once from the synthetic XML
  and checked into the repository.

### Update

| Path                                    | Required update                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package.json                            | Replace all trail aliases with direct bun trail-data/build.ts subcommands. Add only audited pure JS/TS dependencies.                                                                    |
| bun.lock                                | Remove Java-era unused packages and pin any new builder libraries.                                                                                                                      |
| .github/workflows/build-trail-data.yml  | Rename or reduce to TypeScript fixture/verification CI. Remove setup-java, the self-hosted full build, schedule, and server-side generation. Production generation is local and manual. |
| .github/workflows/deploy-client.yml     | Keep archive URL and range preflight; do not generate or download source OSM data.                                                                                                      |
| trail-data/README.md                    | Document Bun-only setup, exact local commands, scratch sizing, interruption recovery, source manifests, and publication.                                                                |
| docs/fog-and-data.md                    | Replace Planetiler wording with the local TypeScript multi-pass pipeline and static-host boundary.                                                                                      |
| docs/releases.md                        | Replace the dedicated runner instructions with the local build, review, upload, and rollback runbook.                                                                                   |
| app routes for Help, Privacy, and Terms | Keep OSM attribution; describe static archive requests and remove any Java/builder implementation detail visible to users.                                                              |
| server/deploy/Caddyfile                 | Retain only the static range handler; verify missing paths cannot reach Bun.                                                                                                            |
| server/deploy/provision.sh              | Retain only static directory ownership needed for publication; add no builder runtime or scheduled job.                                                                                 |
| scripts/check-trail-runtime-sources.ts  | Add checks for forbidden public APIs and ensure no trail runtime refers to a source PBF or build tool.                                                                                  |
| tests and E2E fixtures                  | Keep the current PMTiles browser contract; regenerate the fixture through the TypeScript tool and add coverage for bounded directories and archive bounds.                              |

The application source should need little or no functional change because the
archive contract remains version 1. Do not rewrite the map integration merely
because the offline builder changed.

## Testing strategy

### Parser tests

- Decode dense and ordinary nodes.
- Decode delta-encoded way refs and relation member IDs.
- Decode roles and tag string tables.
- Respect granularity and latitude/longitude offsets.
- Skip unknown protobuf fields.
- Reject unsupported required header features.
- Detect truncated blobs, invalid lengths, unsupported compression, integer
  overflow, and corrupt string indexes.
- Compare fixture entities with the XML fixture.

### Relation and classifier tests

Retain all existing semantic cases:

- hiking, foot, bicycle, and rejected route types;
- direct routes and nested superroutes;
- repeated and cyclic relation membership;
- member roles and missing members;
- every network rank;
- osmc:symbol, colour, color, unsupported values, and fallback;
- hiking/cycling shared ways;
- five hiking colors, deterministic order, four-line cap, and dropped count;
- duplicate relations and ways from overlapping input extracts.

### Tiling and PMTiles tests

- Lines crossing tile boundaries are clipped without gaps.
- Buffer behavior prevents visible seams.
- Identical input does not duplicate a tile feature.
- Tile IDs and order match the pmtiles library.
- Small archives use a root directory correctly.
- Synthetic large-directory fixtures force leaf directories.
- Header offsets, counts, compression types, bounds, and center decode through
  an independent reader.
- The writer never buffers all compressed tiles.
- Interrupted builds never produce the requested final filename.

### Integration tests

1. Synthetic XML and PBF produce identical semantic features.
2. The fixture PMTiles decodes to expected-z12.json.
3. A small dated Geofabrik region builds without network access.
4. Two overlapping regional inputs produce no duplicate output.
5. A country build stays within the measured memory ceiling.
6. A continent build establishes throughput and scratch estimates before a
   planet attempt.
7. The browser E2E suite consumes only the checked-in local fixture.

Routine CI runs only unit tests and the synthetic fixture. It must not download
live OSM or Geofabrik data.

### Client tests

Retain tests for:

- no archive request below z12 or while disabled;
- one source and the expected layers;
- trail placement below fog and imported activities;
- style changes and WebGL restoration;
- corrupt, truncated, missing, offline, and CORS failures;
- an unset archive URL;
- no request to Waymarked Trails, Overpass, OSM APIs, or OSM raster tiles;
- no regression in interaction long-task thresholds.

## Migration phases

### Phase 0 — disable production generation and capture parity

1. Ensure the production client does not point at an unreviewed Java-generated
   archive while the migration is incomplete.
2. Save the current fixture semantic output, archive metadata, representative
   decoded tiles, screenshots, and build report fields as migration oracles.
3. Inventory every Java, Gradle, Planetiler, shell-wrapper, and trail workflow
   reference.
4. Run current client unit, Storybook, E2E, performance, and production-build
   checks.

Exit condition: browser behavior is baselined and no scheduled Java build can
publish another archive.

### Phase 1 — remove Java and establish the TypeScript skeleton

1. Add trail-data/build.ts and the argument/source-manifest tests.
2. Move classifier, report, fixture generation, verification, and publication
   logic to .ts modules.
3. Make the fixture archive byte-deterministic.
4. Delete Java, Gradle, Planetiler, wrappers, and trail shell scripts.
5. Change CI to Bun-only fixture checks.
6. Add a repository guard that fails if Java/JVM trail files return.

Exit condition: the repository has no Java/JVM trail toolchain and all fixture
semantics pass under Bun.

### Phase 2 — prove PBF and bounded storage

1. Implement and fuzz the streaming PBF decoder.
2. Implement SQLite relation, way, and node passes.
3. Prove direct and superroute membership on the PBF fixture.
4. Build a small Geofabrik extract using only local input.
5. Record time, peak RSS, scratch size, retained-object ratios, and errors.

Exit condition: a real regional PBF produces the schema-v1 semantic features
without whole-file or whole-dataset memory use.

### Phase 3 — prove production tiling

1. Implement the disk-backed z12 tile spool.
2. Implement the full PMTiles v3 writer with leaf directories.
3. Run independent archive verification.
4. Build Czechia and one dense cycling region for visual comparison.
5. Verify KCT colors, cycling routes, overlaps, border clipping, and dense tile
   sizes against raw OSM objects and the fixture contract.

Exit condition: regional PMTiles render in the existing browser integration and
pass schema, visual, performance, and deterministic-output gates.

### Phase 4 — scale gate

1. Build one country, then one continent, without changing the algorithm.
2. Optimize only measured bottlenecks while preserving deterministic fixtures.
3. Attempt a dated planet build on the documented local release machine.
4. Review duration, RSS, scratch, archive size, dense tiles, missing geometry,
   overlap cap, and continental sample counts.
5. Choose either global coverage or a documented regional manifest based on
   the measured gate.

Exit condition: the chosen coverage is reproducible and honest. Failure of the
planet gate leaves the feature regional or disabled; it does not authorize a
different language or public API fallback.

### Phase 5 — publish and release

1. Build the final archive locally from the approved manifest.
2. Generate and review report, manifest, SHA-256, and DATA-LICENSE.txt.
3. Upload immutable static artifacts and verify remote ranges/checksums.
4. Set VITE_TRAIL_ARCHIVE_URL to the exact content-addressed URL.
5. Update Help, Privacy, Terms, fog/data, and release documentation.
6. Run typecheck, unit tests, Storybook, E2E, performance, production build,
   runtime-source guard, and external range probes.
7. Release the client and inspect real production attribution and network
   traffic.

Exit condition: production trails come from the reviewed TypeScript-built
archive and no trail code runs in the optional server.

### Phase 6 — refresh runbook

Trail data refreshes are deliberate release operations, not a cron job:

1. Select a new dated public source and update the input manifest.
2. Download it locally and record published checksum plus SHA-256.
3. Run fixture and regional smoke tests.
4. Run the full local build and compare counts/metrics with the prior release.
5. Investigate changes over agreed thresholds.
6. Publish an immutable archive and update the client URL in a normal release.
7. Keep the current archive and at least two predecessors for rollback.

If a refresh fails, keep serving the previous archive.

## Acceptance criteria

The migration is complete only when:

- no .java, .class, .jar, Gradle/Kotlin build file, Gradle wrapper, Planetiler
  dependency, or setup-java action remains for trail data;
- every trail-data implementation and test source file is .ts, apart from
  data fixtures and documentation;
- no trail script launches an external generator, container, JVM, database
  server, or native CLI;
- the builder reads explicit local, dated, checksummed OSM inputs from approved
  public sources;
- routine CI is offline for trail data and uses only the synthetic fixture;
- a real regional archive has been built and independently decoded;
- production coverage and bounds are explicit;
- the production archive passes its source checksums and generated SHA-256;
- the optional Bun server contains no trail route, processor, downloader,
  persistence, proxy, or refresh path;
- the browser uses one immutable PMTiles source and no query/API fallback;
- no trail request carries a key, token, cookie, account ID, or
  activity-derived coordinate;
- trails remain below fog and imported activities and survive style/context
  restoration;
- disabling trails or omitting the archive URL prevents archive requests;
- archive failure does not impair any browser-first feature;
- OSM attribution is visible and the public archive includes ODbL and
  provenance metadata;
- the archive and two prior versions can be rolled back without rebuilding.

## Risks and mitigations

| Risk                                             | Impact                                      | Mitigation                                                                                              |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pure TypeScript planet parsing is too slow       | Global refresh is impractical               | Country and continent gates, batched SQLite operations, measured budgets, and honest regional fallback. |
| Node lookup dominates the scan                   | Excessive build time                        | Block-level batching, indexed wanted-node tables, prepared statements, and per-pass profiling.          |
| Temporary data exceeds local disk                | Failed release build                        | Preflight estimate, configurable scratch path, high-water metrics, and 25% headroom.                    |
| Custom PBF decoding is subtly wrong              | Missing or corrupt routes                   | XML/PBF parity fixture, independent public extracts, corruption tests, and entity-count audits.         |
| Custom PMTiles writing is subtly wrong           | Browser range/decode failures               | Leaf-directory tests, independent pmtiles reader, full fixture decode, and external range probes.       |
| Multi-extract boundaries duplicate data          | Thick or repeated lines                     | OSM ID/version keys, deterministic conflict rules, and tile-level uniqueness keys.                      |
| Relation hierarchy is cyclic or incomplete       | Missing/duplicate superroutes               | Iterative graph resolution, visited sets, cycle counters, and nested fixture cases.                     |
| OSM color tags are inconsistent                  | Misleading colors                           | Closed palette, explicit precedence, neutral fallback, and unsupported-color reporting.                 |
| A future convenience fallback calls a public API | Shared-service abuse and privacy regression | Runtime source guard, source policy tests, and no fallback configuration.                               |
| Static archive origin is unavailable             | Trails disappear                            | Isolated failure, immutable rollback files, and no effect on local app data.                            |
| Licence records drift from inputs                | Compliance risk                             | Per-build manifest, visible attribution, ODbL notice, and release review.                               |

## Primary references

- OpenStreetMap planet PBF index:
  https://planet.openstreetmap.org/pbf/
- OpenStreetMap PBF format:
  https://wiki.openstreetmap.org/wiki/PBF_Format
- Geofabrik public downloads and technical details:
  https://download.geofabrik.de/
  https://download.geofabrik.de/technical.html
- OpenStreetMap route relations:
  https://wiki.openstreetmap.org/wiki/Relation:route
- OpenStreetMap network values:
  https://wiki.openstreetmap.org/wiki/Key:network
- OpenStreetMap osmc:symbol:
  https://wiki.openstreetmap.org/wiki/Key:osmc:symbol
- OpenStreetMap attribution guidance:
  https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OpenStreetMap tile usage policy:
  https://operations.osmfoundation.org/policies/tiles/
- PMTiles specification:
  https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
- PMTiles static hosting guidance:
  https://docs.protomaps.com/pmtiles/cloud-storage
- Mapbox Vector Tile specification:
  https://github.com/mapbox/vector-tile-spec
