# Fog processing and client data

This is the detailed companion to [AGENTS.md](../AGENTS.md). It documents invariants that are easy to break while changing the map, parsers, persistence, photos, laps, or offline support.

## Processing pipeline

Files are parsed into `ParsedActivity[]` on the main thread, then posted to `workers/fogWorker.ts`. The worker simplifies each activity at `ACTIVITY_SIMPLIFY_TOLERANCE`, buffers it, reports lightweight progress every five activities, and emits an updated fog polygon every 300 ms. Corridor mode also flushes after five pending buffers so a fast buffering pass cannot leave one long final clipping operation. `MapView` writes that GeoJSON directly to the fog source.

There are two distinct simplification tolerances. `ACTIVITY_SIMPLIFY_TOLERANCE` (0.0005, about 55 m) applies before buffering; `SIMPLIFY_TOLERANCE` (0.0001, about 11 m) applies to emitted fog. Swapping them visibly degrades the fog boundary or wastes a large vertex budget.

Corridor mode clears only the buffered route. Fill mode unions all activity buffers, strips inner rings, and removes the resulting filled shape from world fog, so closed loops clear their interiors.

Every worker message carries a `runId`. Only call `startFogRun()` when discarding existing work (mode toggle, delete, clear all), and always follow it with `RESET`. Adding activities and restore reprocessing join the existing run. The worker yields a macrotask between activities and serializes same-run batches, so resets cannot land mid-activity.

## Storage and restore

IndexedDB stores activities, photos, and preferences. Preferences include fog mode/cache, session, and sync state. `clearAll()` preserves the session. `loadActivities()` performs read-time migrations for missing `startedAtMs` and `uniqueDistanceKm`; do not re-save old records merely to migrate them.

Map position deliberately uses synchronous localStorage (`fogofwalk:mapPosition`) on each `moveend`; IndexedDB writes can be lost during navigation. A stale fog cache sets `mapStore.isRestoreReprocess`, which reprocesses without fitting bounds and preserves the saved position.

A restored fog cache is render-only: it cannot reconstruct the worker's internal corridor or fill accumulators. The first later import or sync addition therefore resets the worker and replays the full library. Once that replay is queued, later additions can join the run incrementally again.

Use `mapStore.sourcesReady`, not `map.loaded()`, before operating on map sources. A style change destroys custom sources and layers, so `setupMapLayers` must re-add fog, activities, laps, and photos.

## Files, photos, and laps

GPX parsing uses `@tmcw/togeojson`. FIT coordinates from `fit-file-parser` are already degrees; filter pre-lock near-zero points rather than converting semicircles. Add a file format with a parser module and one registry entry in `lib/parsers/index.ts`.

Photos use EXIF time and match the nearest timestamped activity point within five minutes; they need no GPS data. Store the `File`, not an object URL. Recreate object URLs when restoring and revoke every URL when clearing photos.

FIT laps store coordinate index ranges only. Build lap statistics during parsing because point elevation is not persisted. Adjacent laps share their boundary point, while device elapsed duration overrides a naive slice duration. A shared lap is a synthetic render-only activity and must never reach persistence, `mapStore.activities`, unique-distance aggregation, or the fog worker.

## PWA

Workbox builds `app/sw.ts` into `sw.js`, caches the shell and map resources, and implements the web share target. Its contract spans `public/site.webmanifest`, `app/sw.ts`, and `routes/home.tsx`; change those three together.
