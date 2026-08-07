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
  └─ MapView.tsx         mounts MapLibre, owns fog-source + tracks-source + lap-source,
                         handles worker messages
  └─ ControlPanel.tsx    add files / add photos / clear all / show tracks / fill loops / fog toggle
  └─ FileUploadDialog    shown on first load if no tracks
  └─ components/track-stats/
       TrackStatsPanel.tsx    panel chrome — vaul Drawer on mobile, draggable Card on desktop
       SingleTrackStats.tsx   lap selector + stat grid + elevation chart for one track
       MultiTrackStats.tsx    track list + composite totals for a multi-select
       LapSelector.tsx        lap dropdown (Base UI Select)
       DeleteTrackDialog.tsx  delete confirmation
       StatRow.tsx            one label/value pair (renders a fragment into the parent grid)
       formatters.ts          panel-local number formats — see the note in the file
  └─ PhotoCard           draggable panel showing photo viewer for a selected cluster

routes/stats.tsx         clientLoader (loads IDB tracks, runs all aggregators) + StatsPage
  └─ components/stats/
       StatCards.tsx          8 lifetime metric cards (distance, elevation, activities, …)
       WeeklyChart.tsx        Recharts BarChart of weekly km — uses --chart-1 color
       WeekTooltip.tsx        custom Recharts tooltip for WeeklyChart
       StreaksCard.tsx        12-week activity grid + this-week/active/streak stats
       ActivityGrid.tsx       GitHub-style 12×7 dot grid; active dots use --chart-1
       PersonalRecordsCard.tsx  5 per-activity PRs (distance, elevation, pace, speed, time)
       RecordRow.tsx          one PR row, links back to /?track=<id>

routes/help.tsx          static help page

lib/mapStore.ts          module-level singleton — map instance, worker ref, fog data, track list,
                         fogMode, initialCenter/Zoom (from localStorage), isRestoreReprocess flag
lib/storage.ts           IndexedDB layer — tracks, photos (File objects), fog cache, fogMode pref
lib/statsAggregator.ts   pure aggregation functions over ParsedTrack[]: computeLifetimeTotals,
                         computeWeeklyBars, computeStreaks, computePersonalRecords
lib/statsFormatters.ts   pure display formatters: formatKm, formatElevation, formatPace,
                         formatMovingTime, formatXAxisTick, formatWeekRange
lib/laps.ts              format-agnostic lap helpers: buildLapTrack (synthetic track for sharing),
                         lapSubtitle, stripExt. FIT lap extraction lives in parsers/fit.ts
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

## Laps

FIT-only. `fit-file-parser`'s default `mode: 'list'` puts a flat `data.laps` array at the root, so no parser option change was needed. GPX never gets laps (Garmin Connect GPX doesn't encode them — `<trkseg>` splits are pause/resume boundaries).

`ParsedTrack.laps?: TrackLap[]` stores **index ranges** (`startIndex`/`endIndex` into `coordinates`), not geometry, so IndexedDB holds no duplicated coordinates. Lap geometry is `coordinates.slice(startIndex, endIndex + 1)`.

**Lap stats are computed at parse time** (`buildLapsFromFit` in `parsers/fit.ts` → `computeTrackStats(rawPoints.slice(...), LAP_PROFILE_POINTS)`). They cannot be recomputed after a reload: per-point elevation lives only in the parser-internal `RawPoint[]` and is never persisted.

**Lap extraction is parser work, lap presentation is not.** `parsers/fit.ts` owns `buildLapsFromFit` and `fitTimeToMs` (the latter exists because `fit-file-parser` decodes `date_time` into `Date` objects, and `Date.parse(dateObj)` silently truncates ms). `lib/laps.ts` owns only the format-agnostic render-path helpers.

**Adjacent laps share their boundary point** (`laps[k].startIndex === laps[k-1].endIndex`) so highlighted polylines are contiguous and lap distances sum to the track distance. The cost is that a naive `durationMs` would include the bridging gap, so the device's `total_elapsed_time` overrides it when present (which also makes the numbers match the watch and Strava).

**Point→lap assignment is a monotone forward sweep bounded by the *next* lap's `start_time`** — never a `ts >= start && ts <= end` range filter. `lap.timestamp` is the lap *end* and is inclusive, so a range filter double-counts boundary points, drops auto-pause gaps into no lap at all, and yields a set rather than a contiguous range. The sweep runs over `rawPoints`, not raw FIT records, because `fit.ts` filters null-lat/lng and null-island records first so the two index spaces don't line up.

**Lap stats do NOT all sum to the track total** — `elevationGainM` won't, because `computeElevationGainLoss` resets its hysteresis reference and distance-window smoother at each slice boundary. Same for moving time near boundaries. This is expected, not a bug to fix.

**`lap.stats.uniqueDistanceKm` is always 0.** Real unique distance is a library-wide grid computation (`populateUniqueDistances`) re-run on every load/add/delete, so a per-lap share would shift whenever an unrelated track is imported. Consumers must hide the stat — `TrackStatsPanel` gates on `> 0` and `getAvailableStats` already does.

**Sharing a lap uses a synthetic `ParsedTrack`.** `buildLapTrack(track, lap)` returns id `${track.id}#lap${n}` with sliced coordinates, so `ShareDialog` / `drawShareCard` / `ShareMapView` / `filterPhotosForTrack` all work unmodified (photos even narrow to the lap for free). It is **render-path only** — never let it reach `mapStore.tracks`, `saveTracks`, `populateUniqueDistances` or the fog worker. `onDelete` in particular must stay bound to the real track id; `deleteTrack("uuid#lap3")` is a silent IDB no-op.

**The share card draws no track name** — only stat cells, `subtitle` and the watermark. `ShareDialog`'s computed subtitle is `null` for a single track, so a lap card would have nothing identifying it; that's what the optional `subtitle` prop is for.

**Lap state is derived, not reset.** `home.tsx` holds a raw `selectedLapNumber` but everything downstream uses `activeLap`, re-validated each render against the selected track's `laps`. A stale number, a multi-select, a deleted track or a GPX track all collapse to `null` without any of the 8+ `selectedTrackIds` mutation sites knowing laps exist.

**No IDB version bump** — `laps?:` is additive and optional, and structured clone handles it. Tracks imported before the feature existed simply show no selector and cannot be backfilled (`saveTracks` only runs on add-files, and the per-record detail is gone).

## Key gotchas

**One component per file** — outside `components/ui/`. Sub-components get their own file next to
their parent (`StatRow.tsx`, `WeekTooltip.tsx`, `RecordRow.tsx`), and a feature with several parts
gets a folder (`components/track-stats/`, `components/stats/`). The exception is `components/ui/`,
where shadcn's generated files export a whole part family (`Card` + `CardHeader` + `CardTitle` …)
from one file — that's the registry's layout and splitting it would break `shadcn add` updates.

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
| `.fit` | `fit-file-parser` v3 | Returns degrees directly, filter near-(0,0) records; also the only source of laps |

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
LAP_PROFILE_POINTS      = 60    // per-lap elevation profile cap (track's is 300)
MAX_LAPS                = 200   // give up on pathological FIT files above this
LAP_HIGHLIGHT_WIDTH     = 6     // selected-lap line width
```
