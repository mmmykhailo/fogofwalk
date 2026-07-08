# Fog of Walk — Claude Context

## What this is

Browser-only SPA. Users import GPX/FIT activity files and geotagged photos; fog of war clears along their routes. No server — everything runs in the browser. State is persisted in IndexedDB (tracks, photos, fog cache, fogMode) and localStorage (map position).

## Commands

```bash
bun run dev        # dev server
bun run typecheck  # react-router typegen + tsc (run after every change)
bun run build      # production build
bun run format     # prettier
```

## Commit messages

Short, lowercase, imperative, no body — e.g. `add loader`, `fix z-index conflict of drawer and dialog`. Match the existing `git log` style; do not add multi-line descriptions.

## Architecture

```
routes/home.tsx          clientLoader (creates worker, restores IDB state) + clientAction (parses files)
  └─ MapView.tsx         mounts MapLibre, owns fog-source + tracks-source, handles worker messages
  └─ ControlPanel.tsx    add files / add photos / clear all / show tracks / fill loops / fog toggle
  └─ FileUploadDialog    shown on first load if no tracks
  └─ TrackStatsPanel     right-side panel for selected track stats + elevation chart
  └─ PhotoCard           draggable panel showing photo viewer for a selected cluster

routes/stats.tsx         clientLoader (loads IDB tracks, runs all aggregators) + StatsPage
  └─ components/stats/
       StatCards.tsx          8 lifetime metric cards (distance, elevation, activities, …)
       WeeklyChart.tsx        Recharts BarChart of weekly km — uses --chart-1 color
       StreaksCard.tsx        12-week activity grid + this-week/active/streak stats
       ActivityGrid.tsx       GitHub-style 12×7 dot grid; active dots use --chart-1
       PersonalRecordsCard.tsx  5 per-activity PRs (distance, elevation, pace, speed, time)

routes/help.tsx          static help page

lib/mapStore.ts          module-level singleton — map instance, worker ref, fog data, track list,
                         fogMode, initialCenter/Zoom (from localStorage), isRestoreReprocess flag
lib/storage.ts           IndexedDB layer — tracks, photos (File objects), fog cache, fogMode pref
lib/statsAggregator.ts   pure aggregation functions over ParsedTrack[]: computeLifetimeTotals,
                         computeWeeklyBars, computeStreaks, computePersonalRecords
lib/statsFormatters.ts   pure display formatters: formatKm, formatElevation, formatPace,
                         formatMovingTime, formatXAxisTick, formatWeekRange
workers/fogWorker.ts     ALL geometry: simplify → buffer → union/difference → emit fog polygon
lib/parsers/
  index.ts               routes by extension
  gpx.ts                 DOMParser + @tmcw/togeojson (main thread only — DOMParser not in workers)
  fit.ts                 fit-file-parser parseAsync (main thread)
lib/photos.ts            EXIF timestamp extraction + timestamp-based photo-to-track matching (no GPS needed)
lib/stats.ts             haversine distance, elevation gain/loss, pace, elevation profile
```

## Fog algorithm

1. Main thread parses files → `ParsedTrack[]` (unified type, format-agnostic)
2. Sent to worker via `postMessage({ type: "PROCESS_TRACKS", tracks, mode })`
3. Worker: `simplify → buffer` per track, accumulated into `pendingBuffer` (corridor) or `accumulated` (fill)
4. Every 300 ms: flush pending into fog polygon via `@turf/difference`, emit `FOG_UPDATE { fogData }`
5. MapView calls `fogSource.setData(msg.fogData)` — the fog IS the GeoJSON, sent directly

### Corridor vs Fill mode

| | Corridor (default) | Fill |
|---|---|---|
| Worker state | `fogPolygon` + `pendingBuffer` | `accumulated` (persistent across emits) |
| How applied | `difference(fog, pendingBuffer)` per emit | `difference(worldFog, stripInnerRings(accumulated))` per emit |
| Loop behavior | Only 50m corridor cleared | Interior of closed loops also cleared |
| Multi-file loops | Corridors only | Detected — `accumulated` holds all tracks |

`stripInnerRings` removes inner rings from the union polygon, turning an annulus into a filled disk.

## Persistence

### IndexedDB (`lib/storage.ts`)
Three object stores opened via a raw IDB wrapper (no external library):

| Store | keyPath | Contents |
|---|---|---|
| `tracks` | `"id"` | `ParsedTrack` objects (JSON) |
| `photos` | `"id"` | `{ id, file: File, takenAtMs, lng, lat }` — File/Blob stored directly |
| `prefs` | `"key"` | `"fogMode"` (FogMode) + `"fogCache"` (fog GeoJSON + mode + trackIds) |

**Restore flow (clientLoader):** loads tracks → photos → fogMode → fogCache in parallel, populates `mapStore` before component mounts. `setupMapLayers` in MapView reads `mapStore.fogData` and `mapStore.tracks` automatically. If fog cache is stale, `mapStore.isRestoreReprocess = true` and the worker reprocesses after map ready — `fitBounds` is suppressed in this case so saved map position is preserved.

**Photo storage:** `File` objects can be stored directly in modern IDB. `objectUrl` is NOT stored — it is recreated via `URL.createObjectURL()` on load. Photos have a per-photo quota check; if `QuotaExceededError` is thrown, remaining photos in the batch are skipped (they still appear in-session).

**Fog cache invalidation:** cleared on add-files (new tracks added), on fogMode change, and on clear-all.

### localStorage (`lib/mapStore.ts`)
Map center + zoom are saved to `localStorage` (`"fogofwalk:mapPosition"`) **synchronously** on every `moveend` event. Do NOT use IDB for map position — IDB writes are async and are killed if the page is reloaded before the transaction completes. localStorage writes are synchronous and survive page unload. The value is read at module-init time (before any useEffect) so there is no race condition.

## Photos

Photos do **not** need GPS/geotag data. Location is determined entirely by matching the photo's EXIF timestamp to the nearest point in the user's activity tracks.

1. User uploads JPEG/HEIC files via ControlPanel
2. `processPhotoFiles()` (`lib/photos.ts`) extracts EXIF `DateTimeOriginal` (or `DateTime`) via `exifr`
3. Each photo is matched to the nearest track point within a **5-minute timestamp tolerance**; photos with no timestamp or no matching track within the window are silently dropped
4. The photo's map coordinates = the matched track point's `[lng, lat]`
5. Photos are displayed as clustered circular markers on the map (50 px cluster radius, recalculated on zoom)
6. Clicking a cluster opens `PhotoCard` (draggable panel) with per-photo viewer
7. Photo-to-track matching requires `pointTimestamps?: number[]` on `ParsedTrack` — populated by GPX/FIT parsers from coordinate timestamps; if a track has no timestamps, no photos can be matched to it

## Key gotchas

**Boolean state variables use the `is` prefix**: `useState<boolean>` variables should be named `isFoo` / `setIsFoo` — e.g. `isDeleteOpen`, `isCopied`, `isExporting`. Never use bare adjectives like `deleteOpen` or `copied`.

**Phosphor icons — always use the `Icon` suffix**: `@phosphor-icons/react` exports every icon both as `Trash` and `TrashIcon`; the suffix-free names are deprecated. Always import and use the `*Icon` form — `TrashIcon`, `XIcon`, `PlusIcon`, etc. Never import the bare name.

**FIT coordinates**: `fit-file-parser` already returns degrees — do NOT multiply by `180/2^31`. Pre-GPS-lock records have near-zero coordinates; filter with `Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001`.

**Worker URL**: must use relative path `"../workers/fogWorker.ts"` in `new Worker()` — the `~` alias does NOT work for worker URLs (only for imports inside worker files, covered by vite.config.ts `worker.plugins`).

**`map.loaded()` is unreliable**: returns false while `setData()` is running. Use `mapStore.sourcesReady` flag (set in `map.once("load")`) as the guard for all source operations.

**`@turf/union` v7 API**: takes a FeatureCollection, not two separate arguments — `union(featureCollection([a, b]))`.

**`@turf/difference` v7 API**: same — `difference(featureCollection([a, b]))` = a minus b.

**Single useFetcher**: all form submissions go through one `useFetcher` in `home.tsx`; results in `fetcher.data`. Children receive callbacks, not their own fetcher instances.

**Mode change triggers reprocess**: toggling corridor/fill in the UI sends RESET then re-sends all `mapStore.tracks` with the new mode. `mapStore.tracks` persists across resets so it can be replayed.

**`mapStore.fogMode`**: kept in sync with the React `fogMode` state (updated in `handleFogModeChange`). MapView reads it from mapStore in the worker DONE handler to save the fog cache — avoids threading it as a prop.

**`mapStore.isRestoreReprocess`**: set `true` when tracks are restored from IDB but fog cache is stale. Causes DONE handler to skip `fitBounds` so the saved map position is preserved. Reset to `false` after the first DONE.

**Photo objectUrls on restore**: `URL.createObjectURL()` is called in `loadPhotos()` for each restored photo File. These URLs are valid for the session. On clear-all, call `URL.revokeObjectURL()` for all photo entries before clearing state.

**Loading overlay**: `home.tsx` renders a full-screen `#0a0a1e` div unconditionally from first render. It fades out via CSS transition when `mapReady` becomes true, then unmounts on `transitionend`. `body` has `bg-[#0a0a1e]` to prevent a white flash before React renders.

**Explicit route registration**: Routes are NOT auto-discovered from the filesystem. Every route must be added to `app/routes.ts` or it will 404 and `react-router typegen` will not generate its `+types/` file.

**`startedAtMs` read-time migration**: `loadTracks()` checks for the field being `undefined` (tracks saved before it was added) and back-fills it from `pointTimestamps[0]`. The fix is applied in memory only — no re-save — so old IDB data stays untouched.

## Stats page

`/stats` is a separate full-page route (registered in `app/routes.ts`). It is entirely
client-side — `clientLoader` calls `loadTracks()` then runs the four aggregators.

### Aggregators (`lib/statsAggregator.ts`)

| Function | Output |
|---|---|
| `computeLifetimeTotals` | Distance, elevation, moving time, track count, active days |
| `computeWeeklyBars` | One `WeeklyBar` per ISO week between first and last activity; gaps filled with zero |
| `computeStreaks` | Current/longest streak, 84-day active-day set, this-week/last-week km, active-day count |
| `computePersonalRecords` | Best single-activity records: distance, elevation, pace, speed, moving time |

`computeStreaks` uses **local calendar dates** (not UTC) so days match what the user sees on their device.

### Chart colors

`--chart-1` through `--chart-5` in `app/app.css` are a vivid oklch palette (blue, teal,
amber, violet, rose). Both `WeeklyChart` bars and `ActivityGrid` active dots use
`--chart-1`. Add more series by using `--chart-2` … `--chart-5`.

### `startedAtMs` field

`ParsedTrack.startedAtMs: number | null` is the ms timestamp of the first coordinate point.
It is populated by both parsers. Tracks saved to IDB before this field existed are
**migrated at read time** in `loadTracks()` (derives value from `pointTimestamps[0]`,
no re-save needed). Any new consumer of temporal data should use `startedAtMs` — do not
re-derive from `pointTimestamps` elsewhere.

## File format support

| Format | Parser | Notes |
|---|---|---|
| `.gpx` | `@tmcw/togeojson` | Handles LineString + MultiLineString features |
| `.fit` | `fit-file-parser` v3 | Returns degrees directly, filter near-(0,0) records |

To add a new format: create `app/lib/parsers/newformat.ts` + one line in `parsers/index.ts`. Worker, clientAction, and UI are untouched.

## Constants (`app/constants/fog.ts`)

```ts
FOG_CLEAR_RADIUS_METERS = 100   // buffer radius around each track
FOG_EMIT_INTERVAL_MS    = 300   // max fog update frequency
SIMPLIFY_TOLERANCE      = 0.00005  // ~5m at equator (Ramer-Douglas-Peucker)
MAP_STYLE_URL           = "https://tiles.openfreemap.org/styles/liberty"
FOG_COLOR               = "#0a0a1e"
FOG_OPACITY             = 0.8
TRACK_COLOR             = "#ff6b35"
```
