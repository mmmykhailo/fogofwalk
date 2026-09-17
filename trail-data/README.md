# Fog of Walk trail archive builder

This standalone Java 21 profile turns a dated OpenStreetMap `.osm.pbf` snapshot
into the schema-v1 `trails-*.pmtiles` archive consumed by the client. It is not
an npm dependency and is never bundled into the SPA.

The Planetiler and Gradle versions are pinned in `versions.properties` and
`gradle/wrapper/gradle-wrapper.properties`. The wrapper downloads only that
exact Gradle distribution when it is not already cached. Production inputs must
be dated snapshots with a published SHA-256 value; `planet-latest.osm.pbf` is
rejected.

Run the offline fixture first:

```sh
trail-data/scripts/build-fixture.sh
```

Run a regional or planet build with explicit inputs:

```sh
trail-data/scripts/build-region.sh \
  --osm-path=/data/pbf/czechia-260907.osm.pbf \
  --osm-source-url=https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf \
  --osm-source-checksum=sha256:<published-sha256> \
  --output=/data/trails/trails-2026-09-07.pmtiles \
  --report=/data/trails/trails-build-report.json \
  --osm-snapshot=2026-09-07T00:00:00Z
```

`build-planet.sh` has the same interface and is named separately for the
production runbook. Both scripts run the unit suite, refuse an existing output,
and verify the completed archive. `verify-archive.sh` checks PMTiles v3,
z12-only MVT data, the `trails` layer, the four-property schema, palette/rank
ranges, tile size, attribution, and an optional SHA-256 value.

The fixture is intentionally XML and is used by the Java tests and the small
deterministic PMTiles fixture generator. CI does not download live OSM data.
