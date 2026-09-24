# Fog processing and client data

This is the detailed companion to [AGENTS.md](../AGENTS.md). It documents invariants that are easy to break while changing the map, parsers, persistence, photos, laps, or offline support.

The current pipeline is split across `app/lib/activities/`, `app/lib/fog/`,
`app/lib/map/`, and their colocated unit tests. Browser-level regressions live
in `e2e/specs/activity-progress.spec.ts`, `fog-worker.spec.ts`,
`fog-visual.spec.ts`, `paths.spec.ts`, and the map interaction specs below it.

## Processing pipeline

The bounded parser pool in `app/lib/activities/import/service.ts` parses files
on the main thread, normalizes and hashes each activity, and commits the
accepted batch once through `ActivityLibrary`. The committed revision is then
projected to `app/workers/fogWorker.ts`. Its engine simplifies each activity at
`ACTIVITY_SIMPLIFY_TOLERANCE`, buffers it, reports request-local progress, and
emits an updated positive explored-mask collection at most every 300 ms.
`useFogWorkerBridge` validates current revisioned snapshots and writes them to
the fog custom layer, which supplies the surrounding world stencil.

### GPS reliability cleaning

GPX and FIT imports run through the version-5 GPS reliability cleaner in
`app/lib/activities/gpsAnomalies.ts` before statistics, sun phase, FIT laps,
normalization, hashing, persistence, or worker projection. It processes each
original GPX segment independently and keeps point trust, edge drawability, and
fragment confidence as separate decisions. The forward scanner has candidate,
trusted, and excursion states: temporal boundaries retain disconnected
endpoints, returning excursions are removed, and a post-jump candidate becomes
a new disconnected path only after four internally reliable edges and five
points. A short run bounded by unsafe edges is resolved as an isolated fix or
untrusted island rather than allowing a bad point to survive between gaps.

Edge evidence keeps every applicable code, including recording gaps, spatial
jumps, impossible speed, and optional recorded-speed mismatch. Point evidence
uses the hard accuracy limit and a bounded local horizontal-accuracy baseline;
missing or malformed GPX/FIT sensor fields remain unknown and fall back to
coordinate and timestamp evidence. Long stationary runs are summarized in
bounded chunks, merged only across reliable boundaries, and evaluated with
duration, geometry, coordinate speed, and sufficiently covered device-speed
evidence. Removal ranges are sorted and merged before counts and diagnostics
are emitted, so a source point is retained or removed once and examples remain
coordinate-free and bounded.

A long positive timestamp interval creates a path boundary and retains both
endpoints; the cleaner never interpolates a tunnel or pause. Invalid
coordinates, inaccurate fixes, local jumps, impossible-speed excursions, and
stationary GPS drift are removed when they can be identified. No routing
service, road snapping, interpolation, or synthesized coordinate is used.

The stored `paths` and aligned `pathTimestamps` are the single cleaned source
of spatial truth. Laps, map GeoJSON, fog input, unique distance, sharing, and
photo matching must preserve those boundaries and must not flatten them into a
drawable bridge. Activity statistics are geometry-derived except that a FIT
session's device-recorded `total_distance` replaces the aggregate distance and
its pace/speed derivatives when it is within 10% of the cleaned coordinate
distance. This keeps strict anomaly removal from discarding reliable distance
accumulated by the recording device; unique distance and elevation-profile
positions remain geometry-derived. Cleaner diagnostics contain scalar evidence
and exact bounded counts only; they do not log coordinates or source records.

Cleaning is import-time behavior. Activities already stored locally or
downloaded from sync are not rewritten or rehashed automatically. To apply the
new policy to an existing activity, remove it and import the original GPX/FIT
file again; remove the old copy first to avoid duplicate visible tracks and
server identities.

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

Every worker envelope carries a protocol version, request id, and generation
(`runId`); progress and snapshot messages also carry the library revision,
coverage revision, and fog mode. Use the projection helpers in
`app/lib/mapStore.ts`; low-level calls to
`startFogRun()` are only for abandoning existing work and must be followed
immediately by `postToFogWorker({ type: "RESET" })`. Additions normally append
to a compatible complete base. The coordinator coalesces newer committed
snapshots, forces a rebuild when the base is missing or partial, rejects stale
replies, and permits one worker-recovery rebuild. The worker yields a macrotask
between activities and serializes jobs.

Import progress is a batch snapshot over the bounded parser pool: parsing and save progress share one compact stage panel with downstream fog-worker progress. Parsing and save bars remain file-based: each selected file has its own lifecycle stage, each determinate bar uses the immutable number of selected files, and a rejected, failed, or cancelled file settles every displayed stage it can no longer reach. `completedFiles` counts files whose local reading, parsing, normalization, validation, and hashing preparation has ended; an accepted file then waits at `Waiting to save` until the one ordered durable library commit starts. Fog progress is request-activity-based and reads the generation-aware worker status, so an append can count only newly added activities while a rebuild counts the complete replay request. Reached rows stay together in one display session while shown progress is incomplete or either source is active. Once every shown row is complete and both sources are terminal, the whole panel hides after three quiet seconds; a terminal row that remains incomplete is not silently dismissed. A mode toggle starts only a fresh fog row at zero for the new full-library generation. `FogProjectionStatus.processed` and `.total` are request-local, while `FogSnapshot.diagnostics.processed` and `.total` may be cumulative when an append extends an existing worker accumulator.

## Storage and restore

IndexedDB stores full activities, activity summaries, library revision metadata,
photos, saved points, preferences, account-scoped sync state/outboxes, and
derived caches. Preferences include fog mode/cache and the session.
Clearing activities commits `clearLocal` through ActivityLibrary, then removes
the fog cache, unique-distance cache, and activity sync cursors for all
accounts. It preserves photos, saved points, preferences, the session, and
saved-point sync state. Clearing photos only removes the photo store; it does
not rebuild activities or fog, move the map, or touch either sync namespace.
`loadActivities()` performs read-time defaults for missing
`startedAtMs`, `isPublic`, and `uniqueDistanceKm`; do not re-save old records
merely to apply those defaults. Metadata-only edits update the summary overlay
without reading or rewriting geometry.

Map position deliberately uses synchronous localStorage
(`fogofwalk:mapPosition`) on each `moveend`; IndexedDB writes can be lost during
navigation. When the loader rejects a stale or absent fog cache it leaves
`mapStore.fogData` null, and `home.tsx` schedules a restore rebuild after the
map bridge is ready without fitting bounds, preserving the saved position.

A restored fog cache is render-only: it cannot reconstruct the worker's internal corridor or fill accumulators. The first later import or sync addition therefore resets the worker and replays the full library. Once that replay is queued, later additions can join the run incrementally again.

Use `mapStore.sourcesReady`, not `map.loaded()`, before operating on map
sources. A style change or WebGL-context replacement destroys custom state, so
`setupMapLayers` must re-add fog, activities, lap highlighting, saved points,
and marker images; photo DOM markers are rebuilt separately.

Saved points render as one atomic shared symbol marker per point, with the
white centre, coloured body, and white outer stroke kept together. Marker
stacking uses sanitized `createdAt` values, and the shared transparent hit layer
uses the same ordering so selection agrees with what is visible. The fixed
palette marker images are re-registered inside `setupMapLayers()` after style or
WebGL context replacement, before the custom sources are marked ready.

Map background detection uses the centralized interactive-target registry, not
fog geometry or fog visibility. During a style reload, the interaction helpers
query only hit layers that are currently installed, so a temporary missing
layer remains an empty-map click rather than an invalid MapLibre query.

## Files, photos, and laps

GPX parsing uses `@tmcw/togeojson`. FIT coordinates from `fit-file-parser` are already degrees; filter pre-lock near-zero points rather than converting semicircles. Add a file format with a parser module and one registry entry in `lib/parsers/index.ts`.

Photos use EXIF time and match the nearest timestamped activity point within five minutes; they need no GPS data. Store the `File`, not an object URL. Recreate object URLs when restoring and revoke every URL when clearing photos.

FIT laps store coordinate index ranges only. Build lap statistics during parsing because point elevation is not persisted. Adjacent laps share their boundary point, while device elapsed duration overrides a naive slice duration. A shared lap is a synthetic render-only activity and must never reach persistence, `mapStore.activities`, unique-distance aggregation, or the fog worker.

## PWA

Workbox builds `app/sw.ts` into `sw.js`, precaches the app shell, caches standard
map resources, and implements the GPX/FIT web share target. Its contract spans
`public/site.webmanifest`, `app/sw.ts`, and `app/routes/home.tsx`; change those
three together. Shared files remain in `share-target-queue` until the import
action returns a terminal result so a failed import stays retryable.

## Trail overlay data flow

The optional trail overlay is a display-only map resource. Its data flow is:

```text
drawer state
  -> setupMapLayers / setTrailsEnabled
  -> MapLibre source reads Maptoolkit TileJSON
  -> MapLibre fetches visible vector tiles directly
  -> local Fog of Walk line styles filter road.walking_network and
     road.cycling_network
```

The source is `trails-source` and reads
`https://tiles.maptoolkit.org/mtk.json`. The three local line layers are
`trails-hiking-casing-layer`, `trails-hiking-layer`, and
`trails-cycling-layer`; each reads the hosted `road` source layer. Hiking
filters `walking_network` to `iwn`, `nwn`, `rwn`, or `lwn`. Cycling filters
`cycling_network` to `icn`, `ncn`, `rcn`, or `lcn`. All three layers have a
rendering threshold of zoom 7, while the hosted vector source has a maximum
zoom of 15. The existing OpenFreeMap or Esri basemap remains unchanged.

The hiking foreground is blue (#3b82f6) with dash array [3, 2] over the
existing solid light casing. The cycling foreground is light green (#4cb056)
with dash array [2, 2] and no casing.

Maptoolkit's TileJSON supplies the copyright attribution. The map keeps
MapLibre's attribution control expanded at every viewport size, and one
Maptoolkit logo control is shown whenever the hosted source is enabled. Trails
are inserted below the fog layer and imported activity line, are not
interactive targets, and are omitted from share maps and cards. The source,
layers, and logo are recreated from the current session-only switch value on
initial load, flat/relief style changes, and WebGL context restoration.

The browser contacts Maptoolkit directly for TileJSON and visible vector tiles;
the optional Fog of Walk sync server has no trail role. Fog of Walk does not
download OSM data, query a route API, extract or publish trails, proxy the
provider, or put Maptoolkit responses into application-managed Cache Storage or
IndexedDB. The service worker excludes Maptoolkit from its generic map and
style caches. Ordinary transient browser or provider HTTP caching can still
occur and is outside the application's control.

Provider, network, HTTP, CORS, vector-tile decode, and unknown map errors are
reported as bounded coordinate-free diagnostics, at most once per error class
per session. A provider failure affects only the optional overlay; imports,
fog, activities, photos, saved points, basemaps, and optional sync continue to
work. Disabling the drawer switch removes the three trail layers, the source,
and the logo, preventing new trail requests.
