# ADR: bounded fog representation

- Status: accepted
- Date: 2026-09-11
- Scope: browser fog projection and MapLibre GeoJSON handoff
- Version: `FOG_PARTITION_SCHEME_VERSION = 1`

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

| Option | Correctness boundary | Operational cost | Decision |
| --- | --- | --- | --- |
| Custom positive-mask/stencil layer | Strong: MapLibre never tessellates an inverse hole, but requires a separate render path and browser-specific visual testing | New WebGL/render infrastructure and cache shape | Not selected for this release |
| Regional explored masks converted to bounded inverse partitions | Each partition has a finite outer ring; any interior remainder is triangulated before publication | Deterministic Turf operations, bounded source features, straightforward GeoJSON cache | Selected |
| Fixed Web Mercator raster/vector mask with halo ownership | Strong if the edge ownership and halo rules are correct; resolution and seam policy become part of fog semantics | Tile pyramid, raster memory, cache migration, and resolution tuning | Deferred |
| One global inverse polygon with route holes | Fails at the confirmed tile-clipped hole boundary; tuning source tolerance or buffer only moves the artifact | Low initial code cost, unsafe render handoff | Excluded |

## Decision

The worker keeps positive explored masks internally. It unions usable masks once,
then subtracts them from independent `30° × 30°` world partitions bounded by the
supported Web Mercator latitude. Each partition is published as ordinary
hole-free polygons: a remainder with interior rings is triangulated into
contained triangles, while a difficult partition falls back to the validated
fogged partition. The source therefore never receives the old world-shell plus
route-hole topology.

Fill mode removes only intentional interior rings from the explored union before
the partition differences. It does not strip rings independently per MapLibre
tile. A closed loop assembled from multiple activities can therefore be unioned
before it crosses a partition boundary; corridor mode retains the loop interior
as fog. Disconnected source paths are already separate masks at the buffer
boundary, so this representation cannot invent a bridge between them.

The scheme has these safety properties:

- every emitted coordinate is finite and within the supported render latitude;
- each partition is closed and validated before it is published or cached;
- geometry, feature, and byte budgets are checked before a snapshot is accepted;
- a failed union/difference or invalid output produces degraded status and
  fog-safe fallback coverage rather than unchecked partial geometry;
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
The command reports median construction time over three iterations and feature,
ring, vertex, byte, bounds, and validation metrics for the three GeoJSON
representations. The positive-mask candidate measures the semantic explored
geometry that a stencil renderer would consume; it is not an inverse source.

The accepted implementation is the regional bounded inverse. The benchmark is
a correctness and absolute-safety gate first: invalid geometry or an exceeded
budget is a failure. Performance budgets remain provisional until the supported
browser/device matrix is measured with the generated 100, 1,000, and 10,000
activity corpora.

One local Bun run on 2026-09-11 produced the following reference numbers. The
positive-mask time is only the cost of packaging already-buffered masks; a
stencil renderer would add its own GPU upload cost. “Valid” means valid for the
hole-free inverse-source validator, so `false` is expected for the positive
mask and the intentionally unsafe global-hole reference.

| Representation | Median build | Features | Rings | Vertices | JSON bytes | Valid |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Positive explored mask | 0 ms | 24 | 27 | 6,191 | 244,333 | n/a |
| Regional bounded inverse | 716.66 ms | 5,463 | 5,463 | 22,759 | 1,567,332 | yes |
| Global-hole reference | 86.72 ms | 1 | 28 | 6,196 | 242,586 | no |

These values are a baseline for the synthetic fixture, not a product budget.
They show the deliberate trade: bounded inverse output is larger and more
expensive to construct, while the global reference's apparent efficiency is
not an acceptable substitute for valid tile topology. Re-run the command when
the geometry implementation or supported browser matrix changes.

## Consequences

This adds more GeoJSON features than one global polygon and may perform several
small difference operations for a geographically broad library. In return,
MapLibre receives bounded, topology-valid pieces, one numerically difficult
route is isolated to its partition, and cache/style reload behavior is
deterministic. `FOG_PARTITION_SCHEME_VERSION` must be incremented whenever the
partition grid, ownership rule, or output interpretation changes; old fog caches
are then ignored and rebuilt while canonical activities remain untouched.
