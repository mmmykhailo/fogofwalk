# Architecture

## Overview

Fog of Walk is a client-only SPA. All computation happens in the browser. GPX/FIT files are loaded from the local filesystem, processed in a Web Worker, and rendered on a MapLibre GL map.

There is an **optional** sync server (`server/`, see `docs/plans/001-server-sync.md`). It is never required: the client is built without `VITE_API_URL` for the GitHub Pages deployment, which makes `isServerEnabled` false and hides every account and sync surface. All computation stays in the browser either way — the server only stores tracks, it never processes them.

## Data Flow

```
User selects files
  → clientAction (React Router)
      → parseFile() — format dispatcher, runs in main thread
          → parsers/gpx.ts (DOMParser + togeojson)
          → parsers/fit.ts (fit-file-parser parseAsync)
      → ParsedTrack[] pushed to mapStore.tracks
      → Worker: PROCESS_TRACKS message

Web Worker (fogWorker.ts)
  → For each track: simplify → buffer → union
  → Every ~300 ms: FOG_UPDATE { holes } → main thread
  → After all tracks: final FOG_UPDATE + DONE

Main Thread (MapView.tsx onmessage)
  → FOG_UPDATE → mapStore.fogHoles updated
               → fog-source.setData(buildFogGeoJSON(holes))
               → tracks-source.setData(all track LineStrings)
               → fitBounds when processedCount === track total
  → DONE      → isProcessing = false
```

## Component Tree

```
Home (route)
├── MapView          — MapLibre mount, worker onmessage, layer setup
└── ControlPanel     — add files, clear all, track toggle, badge
FileUploadDialog     — shown on first load, triggers file selection
```

## Module Boundaries

- `app/lib/mapStore.ts` — module-level singleton, never in React state
- `app/lib/parsers/` — all format-specific logic isolated here
- `app/workers/fogWorker.ts` — geometry only, no DOM, no React
- `app/constants/fog.ts` — all tunable constants in one place

## Key Invariants

- `mapStore.map` is null until the MapLibre `load` event fires
- Worker is created once in `clientLoader` and stored in `mapStore.worker`
- Fog holes are `GeoJSON.Position[][]` (each item = one hole ring)
- All file parsing happens before the worker receives any message
