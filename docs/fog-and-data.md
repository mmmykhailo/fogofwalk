# Fog processing and client data

This is the detailed companion to [AGENTS.md](../AGENTS.md). It documents invariants that are easy to break while changing the map, parsers, persistence, photos, laps, or offline support.

The modular redesign and its exhaustive edge-case catalog are in the
[activity pipeline refactoring plan](activity-pipeline-refactor-plan.md) and
[activity pipeline test matrix](activity-pipeline-test-matrix.md). The
validation and warning remediation is tracked in the
[fog validation and warning fix plan](fog-validation-and-warning-fix-plan.md).
The invariants below describe the current implementation.

## Processing pipeline

Files are parsed into `ParsedActivity[]` on the main thread, then posted to `workers/fogWorker.ts`. The worker simplifies each activity at `ACTIVITY_SIMPLIFY_TOLERANCE`, buffers it, reports lightweight progress every five activities, and emits an updated positive explored-mask collection every 300 ms. `MapView` writes that GeoJSON to the fog custom layer, which supplies the world stencil.

There are two distinct simplification tolerances. `ACTIVITY_SIMPLIFY_TOLERANCE` (0.0005, about 55 m) applies before buffering; `SIMPLIFY_TOLERANCE` (0.0001, about 11 m) applies to emitted fog. Swapping them visibly degrades the fog boundary or wastes a large vertex budget.

Corridor mode clears only the buffered route. Fill mode indexes intersecting
activity buffers and performs Turf unions in normalized Web Mercator, then
strips inner rings. A merged component is unprojected only as a temporary copy
for pre-commit render validation; the projected merged component remains the
accumulator source of truth. Final emission independently unprojects the
accumulator components, simplifies them with `SIMPLIFY_TOLERANCE`, and
validates them again. This lets closed loops clear their interiors without
constructing a world-minus-route polygon.

The previous world-minus-mask representation had a confirmed MapLibre failure
mode: `geojson-vt` could clip a long route-shaped interior ring against source
tile bounds and Earcut could emit overlapping triangles. The current custom
positive-mask layer avoids that inverse topology. Do not reintroduce the
world-minus-route polygon or treat `maxzoom` freezing and source-option tuning
as production fixes.

This final emission stage is deliberately separate from input simplification
and never mutates the worker accumulator. Each feature is checked for finite
bounded coordinates,
closed non-zero-area rings, topology, and independent feature, vertex, and
serialized-byte limits. The validator reports `valid`, `invalid`,
`budget_exceeded`, or `cancelled`; a work-budget result is not treated as proof
that the geometry is invalid.

Validation and aggregation are feature-local. If one explored component cannot
be validated or exceeds a technical budget, it is omitted while unrelated
validated components remain visible. The resulting snapshot is `partial`, is
not a cache or append base, and is not written as a complete cache. Only a
complete snapshot with a current library/mode/algorithm identity can seed an
append or be cached.

Input normalization retains exact coded event counts and only a bounded set of
redacted examples. Duplicate coalescing and antimeridian splitting are
coverage-neutral informational events; dropped points/paths, input budgets,
validation failures, and geometry fallbacks are coverage-reduced outcomes.
The UI reads these coded counters rather than the bounded example-array length,
so a normal complete run with thousands of duplicate GPS points stays quiet.

Every worker message carries a `runId`. Only call `startFogRun()` when discarding existing work (mode toggle, delete, clear all), and always follow it with `RESET`. Adding activities and restore reprocessing join the existing run. The worker yields a macrotask between activities and serializes same-run batches, so resets cannot land mid-activity.

## Storage and restore

IndexedDB stores activities, photos, and preferences. Preferences include fog mode/cache, session, and sync state. `clearAll()` preserves the session and user controls such as fog mode, while clearing the derived fog cache and sync state. `loadActivities()` performs read-time migrations for missing `startedAtMs` and `uniqueDistanceKm`; do not re-save old records merely to migrate them.

Map position deliberately uses synchronous localStorage (`fogofwalk:mapPosition`) on each `moveend`; IndexedDB writes can be lost during navigation. A stale fog cache sets `mapStore.isRestoreReprocess`, which reprocesses without fitting bounds and preserves the saved position.

A restored fog cache is render-only: it cannot reconstruct the worker's internal corridor or fill accumulators. The first later import or sync addition therefore resets the worker and replays the full library. Once that replay is queued, later additions can join the run incrementally again.

Use `mapStore.sourcesReady`, not `map.loaded()`, before operating on map sources. A style change destroys custom sources and layers, so `setupMapLayers` must re-add fog, activities, laps, and photos.

Map background detection uses the centralized interactive-target registry, not
fog geometry or fog visibility. During a style reload, the interaction helpers
query only hit layers that are currently installed, so a temporary missing
layer remains an empty-map click rather than an invalid MapLibre query.

## Files, photos, and laps

GPX parsing uses `@tmcw/togeojson`. FIT coordinates from `fit-file-parser` are already degrees; filter pre-lock near-zero points rather than converting semicircles. Add a file format with a parser module and one registry entry in `lib/parsers/index.ts`.

Photos use EXIF time and match the nearest timestamped activity point within five minutes; they need no GPS data. Store the `File`, not an object URL. Recreate object URLs when restoring and revoke every URL when clearing photos.

FIT laps store coordinate index ranges only. Build lap statistics during parsing because point elevation is not persisted. Adjacent laps share their boundary point, while device elapsed duration overrides a naive slice duration. A shared lap is a synthetic render-only activity and must never reach persistence, `mapStore.activities`, unique-distance aggregation, or the fog worker.

## PWA

Workbox builds `app/sw.ts` into `sw.js`, caches the shell and map resources, and implements the web share target. Its contract spans `public/site.webmanifest`, `app/sw.ts`, and `routes/home.tsx`; change those three together.
