# Fog of Walk

Fog of Walk is a browser-first SPA for importing GPX/FIT activities and photos, then clearing map fog along the recorded routes. The sync server is optional: all parsing, geometry, rendering, and persistence work in the browser without it.

Read the focused references before changing their area:

- [Development guide](docs/development.md) — commands, worktrees, UI conventions, routes, and commits.
- [Fog processing and client data](docs/fog-and-data.md) — worker processing, persistence, map state, parsers, photos, laps, and PWA behavior.
- [Statistics and optional sync](docs/stats-and-sync.md) — aggregators, server invariants, deletion semantics, upload pacing, and E2E coverage.

## Essential architecture

`app/routes/home.tsx` restores map data, owns map mutations, and coordinates the activity library and fog projection. `app/lib/activities/` owns import normalization and durable library commits. `app/components/map/MapView.tsx` composes the MapLibre lifecycle, presentation, interactions, photos, saved points, and fog-worker bridge; those responsibilities live in its focused hooks. `app/lib/mapStore.ts` projects module-level map, worker, activity, and revision state. `app/workers/fogWorker.ts` is a thin transport adapter around the geometry engine in `app/lib/fog/engine/`.

Application pages, including stats, help, activity and saved-point libraries, and public profiles, are explicitly registered in `app/routes.ts`. Shared page chrome is in `app/components/PageShell.tsx` and `app/components/PageSection.tsx`. Reusable responsive page-section layouts use `app/components/Grid.tsx`; configure its `columns` rather than repeating standard grid utility combinations. Grid spacing is always `gap-3`.

The sync server is an independent package in `server/`; its shared contracts live in `shared/`. The server-optional invariant is non-negotiable: an unset `VITE_API_URL` must leave the client fully usable without network access.

## Critical invariants

- Preserve the distinction between activity and emitted-fog simplification tolerances.
- Schedule fog work through the `mapStore` projection helpers. Low-level commands must go through `postToFogWorker()` so the coordinator stamps the current generation, request, library revision, coverage revision, and mode.
- Use `mapStore.sourcesReady`, not `map.loaded()`, before changing sources.
- Worker URLs must be relative (`../workers/fogWorker.ts`), not `~` aliases.
- Turf v7 `union` and `difference` take a `FeatureCollection`.
- Do not make direct API requests from React components; use route loaders/actions and fetchers.
