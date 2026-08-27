# Fog of Walk

Fog of Walk is a browser-first SPA for importing GPX/FIT activities and photos, then clearing map fog along the recorded routes. The sync server is optional: all parsing, geometry, rendering, and persistence work in the browser without it.

Read the focused references before changing their area:

- [Development guide](docs/development.md) — commands, worktrees, UI conventions, routes, and commits.
- [Fog processing and client data](docs/fog-and-data.md) — worker processing, persistence, map state, parsers, photos, laps, and PWA behavior.
- [Statistics and optional sync](docs/stats-and-sync.md) — aggregators, server invariants, deletion semantics, upload pacing, and E2E coverage.

## Essential architecture

`routes/home.tsx` restores IndexedDB state, owns file mutations, and coordinates the fog worker. `MapView.tsx` owns MapLibre sources and worker updates. `lib/mapStore.ts` is the module-level map/worker/activity store; `workers/fogWorker.ts` owns all fog geometry.

`routes/stats.tsx`, `routes/help.tsx`, and public profile routes are explicitly registered in `app/routes.ts`. Shared page chrome is in `components/PageShell.tsx` and `components/PageSection.tsx`. Reusable responsive page-section layouts use `components/Grid.tsx`; configure it with `columns` and `gap` rather than repeating standard grid utility combinations.

The sync server is an independent package in `server/`; its shared contracts live in `shared/`. The server-optional invariant is non-negotiable: an unset `VITE_API_URL` must leave the client fully usable without network access.

## Critical invariants

- Preserve the distinction between activity and emitted-fog simplification tolerances.
- Post fog-worker messages through `postToFogWorker()` so every message has the current `runId`.
- Use `mapStore.sourcesReady`, not `map.loaded()`, before changing sources.
- Worker URLs must be relative (`../workers/fogWorker.ts`), not `~` aliases.
- Turf v7 `union` and `difference` take a `FeatureCollection`.
- Do not make direct API requests from React components; use route loaders/actions and fetchers.
