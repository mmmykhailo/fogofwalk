# ADR: bounded fog representation

- Status: accepted (supersedes the regional inverse implementation)
- Date: 2026-09-11
- Scope: browser fog projection and MapLibre GeoJSON handoff
- Version: `FOG_PARTITION_SCHEME_VERSION = 3`

## Context

The old fog source represented the entire Web Mercator world as one polygon
with route-shaped interior rings. MapLibre's tiler clips the outer ring and the
interior rings independently. When a long route crosses a tile boundary, the
clipped interior can touch the clipped world shell. Earcut then receives a hole
that is not strictly contained and can emit overlapping triangles. The visual
symptom is extra, darker fog at particular zoom bands, not lost canonical
activity data.

The representation must preserve both corridor and closed-loop fill semantics,
remain safe at the antimeridian and projection limits, and keep geometry small
enough for a browser worker and structured-clone handoff. A cached render must
also remain safe when the worker is restarted or the map style is reloaded.

## Options considered

| Option                                                          | Correctness boundary                                                                                             | Operational cost                                                                      | Decision   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| Custom positive-mask/stencil layer                              | Strong: MapLibre never tessellates an inverse hole; browser visual testing covers the shared WebGL path          | New WebGL/render infrastructure and cache shape                                       | Selected   |
| Regional explored masks converted to bounded inverse partitions | Each partition has a finite outer ring; any interior remainder is triangulated before publication                | Deterministic Turf operations, bounded source features, straightforward GeoJSON cache | Superseded |
| Fixed Web Mercator raster/vector mask with halo ownership       | Strong if the edge ownership and halo rules are correct; resolution and seam policy become part of fog semantics | Tile pyramid, raster memory, cache migration, and resolution tuning                   | Deferred   |
| One global inverse polygon with route holes                     | Fails at the confirmed tile-clipped hole boundary; tuning source tolerance or buffer only moves the artifact     | Low initial code cost, unsafe render handoff                                          | Excluded   |

## Decision

The worker publishes positive explored masks in longitude/latitude. Corridor
mode keeps disconnected path buffers as separate features; fill mode unions the
accumulator incrementally and strips intentional loop interiors. The map uses
a MapLibre custom layer: Earcut triangulates the positive masks only into the
WebGL stencil buffer, then one fog-colored world quad is drawn wherever the
stencil is clear. Triangle edges therefore never become visible fill edges, and
MapLibre's GeoJSON tiler never receives a world shell with route-shaped holes.

Fill mode removes only intentional interior rings from the explored union. A
closed loop assembled from multiple activities can therefore be filled without
depending on tile clipping; corridor mode retains the loop interior as fog.
Disconnected source paths remain separate from the buffer boundary through the
custom layer, so this representation cannot invent a bridge between them.
The fill accumulator keeps a coarse spatial index of positive components and
unions only components whose projected bounds intersect. Disjoint additions do
not trigger a global union; touched cells are tracked as dirty for the next
publication.

The scheme has these safety properties:

- every emitted coordinate is finite and within the supported render latitude;
- each positive mask is closed and validated before it is published or cached;
- geometry, feature, and byte budgets are checked before a snapshot is accepted;
- a failed union or invalid output produces degraded status and full-fog
  fallback coverage rather than unchecked partial geometry;
- cache identity includes library revision, fog mode, algorithm version, and
  partition scheme version;
- a render-only cache is never treated as worker accumulator state, so the next
  append rehydrates by replaying the committed library.

## Benchmark spike

Run the deterministic synthetic comparison with:

```sh
bun run bench:fog
```

The fixture is generated in `scripts/bench-fog-representations.ts` and contains
24 routes with 96 points each, including a route crossing a partition and closed
loops. It contains no private activity, names, coordinates, or screenshots.
The command reports median/p95 construction time, post-run heap observation, and
feature, ring, vertex, byte, bounds, and validation metrics. Its baseline compares
the positive mask, the selected regional inverse, and the excluded global-hole
reference. It also measures the selected positive projection at deterministic
100, 1,000, and 10,000 pre-buffered-mask tiers, then runs the same scale tiers
through the real `FogEngine.process()` path. The engine rows include buffering,
intermediate publication, structured cloning, validation, and final cache-payload
serialization; a partial row records the safe fallback and remains non-cacheable.
The positive-mask candidate measures the semantic explored geometry that a
stencil renderer would consume; it is not an inverse source.

The accepted implementation is the positive mask plus stencil layer. The
benchmark is a correctness and absolute-safety gate first: invalid geometry or
an exceeded budget is a failure. Performance budgets remain provisional until
the supported browser/device matrix is measured with the generated 100, 1,000,
and 10,000 activity corpora.

One local Bun run on 2026-09-11 produced the following historical reference numbers. The
positive-mask time is the cost of packaging already-buffered masks; the
stencil layer uploads only those positive triangles. “Valid” means valid for the
positive-mask validator; the global-hole row remains a historical semantic
reference and is not a production positive-mask payload.

| Representation           | Median build | p95 build | Heap after run | Features | Rings | Vertices | JSON bytes | Valid |
| ------------------------ | -----------: | --------: | -------------: | -------: | ----: | -------: | ---------: | ----- |
| Positive explored mask   |         0 ms |      0 ms |        1.76 MB |       24 |    27 |    6,191 |    244,333 | n/a   |
| Regional bounded inverse |    667.96 ms | 853.48 ms |       29.78 MB |    5,463 | 5,463 |   22,759 |  1,566,472 | yes   |
| Global-hole reference    |     87.03 ms |  88.91 ms |       47.69 MB |        1 |    28 |    6,196 |    242,586 | no    |

These values are a historical baseline for the superseded regional inverse,
not a product budget. The positive-mask implementation avoids the global
world-minus-route topology and keeps publication proportional to explored
geometry; re-run the command when the geometry implementation or supported
browser/device matrix changes.

## Consequences

The custom layer adds a small WebGL path and requires browser visual coverage,
but it avoids sending an inverse world shell through MapLibre's GeoJSON tiler.
Positive geometry, cache/style reload behavior, and worker replay remain
deterministic. `FOG_PARTITION_SCHEME_VERSION` must be incremented whenever the
positive geometry interpretation or stencil contract changes; old fog caches
are then ignored and rebuilt while canonical activities remain untouched.
