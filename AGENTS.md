# Fog of Walk — Claude Context

## What this is

Browser-only SPA with an **optional** sync server. Users import GPX/FIT activity files and geotagged photos; fog of war clears along their routes. No server is *required* — all parsing, geometry and rendering run in the browser, and the GitHub Pages build ships without a server at all. State is persisted in IndexedDB (tracks, photos, fog cache, fogMode, session, syncState) and localStorage (map position). It is also an installable PWA — see "PWA and offline" below.

## Commands

```bash
bun run dev        # dev server
bun run typecheck  # react-router typegen + tsc (run after every change)
bun run build      # production build
bun run test       # Bun unit tests for the client app
bun run format     # prettier
```

`bun run format` is `prettier --write "**/*.{ts,tsx}"` — it rewrites every ts/tsx file in the
tree (not css/md/json), and the repo has drifted from the current prettier config, so it produces
churn in files you did not touch. Format only what you changed: `bunx prettier --write <paths>`.

## Worktrees and local environment

When creating a new Git worktree, carry over ignored local environment files by creating symlinks
to `.env` and `server/.env` from the primary worktree, when those source files exist. Never copy
or commit those files. This is required before running commands that rely on the local API URL or
server credentials.

E2E tests (separate package — Playwright, real browser against the real server):

```bash
bun run test:e2e   # or: cd e2e && bun run test
cd e2e && bun run typecheck   # the root typecheck excludes e2e/ too
```

Optional sync server (separate package, see "Sync server" below):

```bash
cd server && bun install
bun run dev        # bun --hot src/index.ts
bun run typecheck  # tsc --noEmit — the root typecheck excludes server/
bun test           # runs against the in-memory store driver
```

## Commit messages

Short, lowercase, imperative, no body — e.g. `add loader`, `fix z-index conflict of drawer and dialog`. Match the existing `git log` style; do not add multi-line descriptions.

**Never add `Co-Authored-By:` trailers** (or any other trailer) to commits. Single-line subject only.

## Architecture

```
routes/home.tsx          clientLoader (creates worker, restores IDB state) + clientAction (parses files)
  └─ MapView.tsx         mounts MapLibre, owns fog-source + tracks-source + lap-source,
                         handles worker messages
  └─ ControlPanel.tsx    the two hidden file inputs, the progress pill, and the FAB that opens
                         MoreDrawer. It owns no switches — they all live in MoreDrawer.
  └─ MoreDrawer.tsx      the actual control surface: add files / add photos, show tracks / show fog /
                         show photos / fill loops switches, flat-vs-relief map style, nav card
                         (account, /stats, /help), clear all
  └─ MapCompass.tsx      bearing/pitch indicator, click to reset north
  └─ FileUploadDialog    shown on first load if no tracks — also offers sign-in and a sample run
  └─ ShareDialog.tsx     3:4 share card builder (background mode, blur, up to 4 stats, copy/download)
       ShareMapView.tsx  offscreen MapLibre instance used to snapshot the map for the card
  └─ ClearAllDialog / DuplicateTracksDialog / ParseErrorDialog / PhotoErrorDialog
                         the four outcome dialogs home.tsx drives off fetcher.data
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
       StatCards.tsx          12 lifetime metric cards (distance, unique distance, moving time,
                              elevation, activities, active days, and six averages)
       WeeklyChart.tsx        Recharts BarChart of weekly km — uses --chart-1 color
       WeekTooltip.tsx        custom Recharts tooltip for WeeklyChart
       StreaksCard.tsx        12-week activity grid + this-week/active/streak stats
       ActivityGrid.tsx       GitHub-style 12×7 dot grid; active dots use --chart-1
       PersonalRecordsCard.tsx  5 per-activity PRs (distance, elevation, pace, speed, time)
       RecordRow.tsx          one PR row, links back to /?track=<id>

routes/help.tsx          static help page — section composition only
  └─ components/help/     one component per section (see "One component per file")

components/PageShell.tsx / PageSection.tsx / AppLink.tsx
                         shared chrome for the non-map routes (/help, /stats)
components/ErrorBoundary.tsx / ErrorCard.tsx   route-level error UI
components/ElevationChart.tsx  Recharts area chart, used by both track stats and laps

routes/auth-callback.tsx OAuth landing — trades the single-use handoff code for a bearer token
  └─ components/account/
       AccountDrawerItem.tsx     the row in MoreDrawer's nav card (null when no server)
       SignInDialog.tsx          provider list
       AccountDialog.tsx         identity + sync status + log out + delete
       DeleteAccountBlock.tsx    in-place second verification, NOT a nested dialog
       ServerUnavailableNotice.tsx  the offline placeholder, shared by every server surface
       PurgeServerBlock.tsx      in-place verification for "Remove all" (DELETE /api/tracks)
       AccountAvatar.tsx         provider image with initials fallback

lib/mapStore.ts          module-level singleton — map instance, worker ref, fog data, track list,
                         fogMode, initialCenter/Zoom (from localStorage), isRestoreReprocess flag,
                         ingestTracks() (shared by add-files and sync downloads)
lib/storage.ts           IndexedDB layer — tracks, photos (File objects), fog cache, fogMode pref,
                         session + syncState (both in the generic `prefs` KV)
lib/statsAggregator.ts   pure aggregation functions over ParsedTrack[]: computeLifetimeTotals,
                         computeWeeklyBars, computeStreaks, computePersonalRecords,
                         computeUniqueDistance; plus sortTracks and populateUniqueDistances
lib/statsFormatters.ts   pure display formatters: formatKm, formatElevation, formatPace,
                         formatSpeed, formatMovingTime, formatXAxisTick, formatWeekRange
lib/laps.ts              format-agnostic lap helpers: buildLapTrack (synthetic track for sharing),
                         lapSubtitle, stripExt. FIT lap extraction lives in parsers/fit.ts
lib/formatRelativeTime.ts  calendar-day-based "today at 18:15" / "yesterday at 00:03" / "5 days ago" /
                         "a week ago" / "a month ago" / "1 year ago" formatter — shared anywhere a
                         timestamp needs a human relative label (currently the public profile's
                         TrackCard, `components/public-profile/TrackCard.tsx`)
workers/fogWorker.ts     ALL geometry: simplify → buffer → union/difference → emit fog polygon
lib/parsers/
  index.ts               routes by extension
  gpx.ts                 DOMParser + @tmcw/togeojson (main thread only — DOMParser not in workers)
  fit.ts                 fit-file-parser parseAsync (main thread)
lib/photos.ts            EXIF timestamp extraction + timestamp-based photo-to-track matching (no GPS needed)
lib/stats.ts             haversine distance, elevation gain/loss, pace, elevation profile
lib/shareCard.ts         drawShareCard — canvas rendering of the 3:4 share image
lib/trackHash.ts         SHA-256 over canonical geometry (the sync identity of a track)
lib/useDraggable.ts / useIsMobile.ts / useCopyToClipboard.ts / utils.ts    small shared hooks
sw.ts                    Workbox service worker — see "PWA and offline"
routes.ts                explicit route table (see the gotcha below)
```

## Fog algorithm

1. Main thread parses files → `ParsedTrack[]` (unified type, format-agnostic)
2. Sent to worker via `postMessage({ type: "PROCESS_TRACKS", tracks, mode })`
3. Worker: `simplify` (at `TRACK_SIMPLIFY_TOLERANCE`) → `buffer` (`FOG_CLEAR_RADIUS_METERS`, `BUFFER_STEPS`) per track, accumulated into `pendingBuffer` (corridor) or `accumulated` (fill)
4. Every 300 ms: flush pending into fog polygon via `@turf/difference`, simplify the *result* at `SIMPLIFY_TOLERANCE`, emit `FOG_UPDATE { fogData }`
5. MapView calls `fogSource.setData(msg.fogData)` — the fog IS the GeoJSON, sent directly

**Two different simplify tolerances, and mixing them up is a visible bug.**
`TRACK_SIMPLIFY_TOLERANCE` (0.0005, ~55 m) is applied to the *track* before buffering — it can be
coarse because the 100 m buffer swallows the corner-cutting. `SIMPLIFY_TOLERANCE` (0.0001, ~11 m)
is applied to the *emitted fog polygon* and controls the visual precision of the fog edge.
Swapping them either ruins the fog boundary or wastes an order of magnitude of vertex budget.

### Corridor vs Fill mode

| | Corridor (default) | Fill |
|---|---|---|
| Worker state | `fogPolygon` + `pendingBuffer` | `accumulated` (persistent across emits) |
| How applied | `difference(fog, pendingBuffer)` per emit | `difference(worldFog, stripInnerRings(accumulated))` per emit |
| Loop behavior | Only the 100 m corridor cleared | Interior of closed loops also cleared |
| Multi-file loops | Corridors only | Detected — `accumulated` holds all tracks |

`stripInnerRings` removes inner rings from the union polygon, turning an annulus into a filled disk.

## Persistence

### IndexedDB (`lib/storage.ts`)
Three object stores opened via a raw IDB wrapper (no external library):

| Store | keyPath | Contents |
|---|---|---|
| `tracks` | `"id"` | `ParsedTrack` objects (JSON) |
| `photos` | `"id"` | `{ id, file: File, takenAtMs, lng, lat }` — File/Blob stored directly |
| `prefs` | `"key"` | four keys: `"fogMode"` (FogMode), `"fogCache"` (fog GeoJSON + mode + trackIds), `"session"` (bearer token + user), `"syncState"` (cursor, appliedTombstones, ignoredHashes) |

`prefSet`/`prefGet` are module-private, so that list is exhaustive. `clearAll()` drops everything
except `"session"` — a clear-all must not sign you out.

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
gets a folder (`components/track-stats/`, `components/stats/`, `components/help/`, `components/public-profile/`).
This applies to route files too — a route module should export only the route (`clientLoader`/`clientAction`/
default component/`meta`), not inline presentational components; e.g. `routes/u.$handle.tsx`'s `TrackCard` and
`Stat` live in `components/public-profile/TrackCard.tsx` and `components/public-profile/Stat.tsx`, not inline in
the route. We always want one component per file, no exceptions beyond the one below. The exception is
`components/ui/`, where shadcn's generated files export a whole part family (`Card` + `CardHeader` + `CardTitle` …)
from one file — that's the registry's layout and splitting it would break `shadcn add` updates.

**Base UI popups inside a vaul Drawer need care**: vaul renders a Radix `Dialog.Root` but never forwards its own `modal` prop to it, so a drawer is **always** a trapped Radix `FocusScope` — `modal={false}` only makes vaul `preventDefault()` the outside-press/focus-out events. Base UI popups portal to `<body>`, outside that scope, so when one focuses its content Radix's `focusout` handler yanks focus back into the drawer. For `Select` that is fatal: `SelectTrigger.onFocus` closes the popup whenever `alignItemWithTrigger` is active, so it opens and dismisses itself in the same frame (looks like "the dropdown flickers and won't open"). Two guards are in place — `useBaseUiPortalFocusGuard` in `ui/drawer.tsx` (fixes the root cause for any Base UI popup) and `alignItemWithTrigger={false}` on `LapSelector`'s `SelectContent`. Related, already-existing workarounds: the `[data-base-ui-portal]` check in `DrawerContent`'s `onPointerDownOutside` and the focus-restore effect in `ui/dialog.tsx`. Do **not** try to fix this by portalling the popup into the drawer — vaul puts a `transform` on the drawer content, which makes it a containing block for `position: fixed` and sends the popup off-screen.

**Boolean state variables use the `is` prefix**: `useState<boolean>` variables should be named `isFoo` / `setIsFoo` — e.g. `isDeleteOpen`, `isCopied`, `isExporting`. Never use bare adjectives like `deleteOpen` or `copied`.

**Phosphor icons — always use the `Icon` suffix**: `@phosphor-icons/react` exports every icon both as `Trash` and `TrashIcon`; the suffix-free names are deprecated. Always import and use the `*Icon` form — `TrashIcon`, `XIcon`, `PlusIcon`, etc. Never import the bare name.

**FIT coordinates**: `fit-file-parser` already returns degrees — do NOT multiply by `180/2^31`. Pre-GPS-lock records have near-zero coordinates; filter with `Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001`.

**Worker URL**: must use relative path `"../workers/fogWorker.ts"` in `new Worker()` — the `~` alias does NOT work for worker URLs (only for imports inside worker files, covered by vite.config.ts `worker.plugins`).

**`map.loaded()` is unreliable**: returns false while `setData()` is running. Use `mapStore.sourcesReady` flag (set in `map.once("load")`) as the guard for all source operations.

**`@turf/union` v7 API**: takes a FeatureCollection, not two separate arguments — `union(featureCollection([a, b]))`.

**`@turf/difference` v7 API**: same — `difference(featureCollection([a, b]))` = a minus b.

**Single useFetcher**: all form submissions go through one `useFetcher` in `home.tsx`; results in `fetcher.data`. Children receive callbacks, not their own fetcher instances.

**Mode change triggers reprocess**: toggling corridor/fill in the UI sends RESET then re-sends all `mapStore.tracks` with the new mode. `mapStore.tracks` persists across resets so it can be replayed.

**`runId` cancels in-flight worker runs**: every worker message carries a generation token. `startFogRun()` (`lib/mapStore.ts`) bumps `mapStore.runId`; the worker bails out of its loop at the next checkpoint once its captured id stops matching, and MapView drops any reply whose `runId` is stale. Post everything through `postToFogWorker()` so the stamp is never forgotten.

- Call `startFogRun()` **only where prior work is genuinely discarded** — fog-mode toggle, `delete-track`, `clear-all`. `add-files` and the restore-reprocess must *join* the current run: they post only the new tracks and depend on the worker's accumulated `fogPolygon`/`accumulated` surviving.
- `startFogRun()` must always be followed by `postToFogWorker({ type: "RESET" })`. That is how the worker learns the new id; without it the old loop keeps running while every reply is dropped, and the progress bar sticks forever.
- The worker's loop `await`s a **macrotask** (`MessageChannel`) once per track. `await Promise.resolve()` would not work — it drains only microtasks, so a queued RESET would never be dispatched. The loop is parked exactly at that await whenever the message handler runs, which is why `resetState()` can never land mid-track.
- `jobChain` serializes same-run batches. Once the loop yields, two `PROCESS_TRACKS` for one run could otherwise interleave over the shared accumulators.
- This also fixes two older bugs: an abandoned run's `DONE` used to write a fog cache pairing the *new* `mapStore.fogMode` with the *old* mode's polygon, and `clear-all`/`delete-track` used to get repainted by the doomed run's `FOG_UPDATE`s.

**`mapStore.fogMode`**: kept in sync with the React `fogMode` state (updated in `handleFogModeChange`). MapView reads it from mapStore in the worker DONE handler to save the fog cache — avoids threading it as a prop.

**`mapStore.isRestoreReprocess`**: set `true` when tracks are restored from IDB but fog cache is stale. Causes DONE handler to skip `fitBounds` so the saved map position is preserved. Reset to `false` after the first DONE.

**Photo objectUrls on restore**: `URL.createObjectURL()` is called in `loadPhotos()` for each restored photo File. These URLs are valid for the session. On clear-all, call `URL.revokeObjectURL()` for all photo entries before clearing state.

**Loading overlay**: `home.tsx` renders a full-screen `#0a0a1e` div unconditionally from first render. It fades out via CSS transition when `mapReady` becomes true, then unmounts on `transitionend`. `body` has `bg-[#0a0a1e]` to prevent a white flash before React renders.

**Explicit route registration**: Routes are NOT auto-discovered from the filesystem. Every route must be added to `app/routes.ts` or it will 404 and `react-router typegen` will not generate its `+types/` file.

**Two read-time migrations in `loadTracks()`**, both applied in memory only — no re-save — so old IDB data stays untouched:
- `startedAtMs === undefined` (tracks saved before the field existed) → back-filled from `pointTimestamps[0]`.
- `stats.uniqueDistanceKm === undefined` → seeded from `stats.distanceKm`. It is immediately overwritten by `populateUniqueDistances`, so the value only has to be non-`undefined` for the interim render.

**PWA and offline**: `vite-plugin-pwa` builds `app/sw.ts` (Workbox) into `sw.js`; `app/root.tsx` registers it. Map tiles are `CacheFirst` for 30 days (200 entries), style JSON is `StaleWhileRevalidate`, and the app shell is precached — which is what makes it usable offline after a first load. The manifest also declares a **Web Share Target** (`public/site.webmanifest`): the OS share sheet can POST `.gpx`/`.fit` files to `/?share-target`, the service worker buffers them into the `share-target-queue` cache and redirects to `/?from-share`, and `home.tsx` drains that queue on load. Changing the share-target contract means changing all three of manifest, `sw.ts` and `home.tsx` together.

**Map style modes**: `MapMode = "flat" | "relief"` (`app/types/tracks.ts`). `flat` is `MAP_STYLE_URL` (OpenFreeMap vector); `relief` swaps in `SATELLITE_STYLE` (Esri raster) via `map.setStyle` and adds a terrain DEM source with `exaggeration: 2.5`. `setStyle` destroys all custom sources and layers, so `setupMapLayers` has to run again after the style loads — the fog, tracks, laps and photo layers are re-added, not preserved.

## Stats page

`/stats` is a separate full-page route (registered in `app/routes.ts`). It is entirely
client-side — `clientLoader` calls `loadTracks()` then runs the five aggregators.

### Aggregators (`lib/statsAggregator.ts`)

| Function | Output |
|---|---|
| `computeLifetimeTotals` | Distance, elevation, moving time, track count, active days |
| `computeWeeklyBars` | One `WeeklyBar` per ISO week between first and last activity; gaps filled with zero |
| `computeStreaks` | Current/longest streak, 84-day active-day set, this-week/last-week km, active-day count |
| `computePersonalRecords` | Best single-activity records: distance, elevation, pace, avg speed, moving time |
| `computeUniqueDistance` | Library-wide unique km — a grid dedupe across every track, so it is not a sum of per-track values |

**Naming: `avgSpeed` vs `avgMovingSpeed`.** `avgSpeedKmh` is distance ÷ *elapsed* time; `avgMovingSpeedKmh` is distance ÷ *moving* time (stopped segments excluded — see `MOVING_TIME_STOPPED_GAP_MS`). Never introduce a bare `speed`/`speedKmh` identifier — always qualify which one it is. The one exception is `segmentSpeedKmh` in `lib/stats.ts`, an instantaneous per-segment speed that only gates whether a segment counts as moving. `PersonalRecords.fastestAvgSpeed` uses the elapsed-time average; `fastestPace` uses moving pace, so the two are independent records rather than reciprocals of one another.

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

## Sync server (optional)

`server/` is an **independent Bun package** — not a workspace. `bun install` at the root must keep
working for people who only want the static app, and the GitHub Pages workflow must never pull
server dependencies. Typecheck it with `cd server && bun run typecheck`; the root `tsconfig.json`
excludes `server/` for exactly that reason.

**Server-optional is the load-bearing invariant.** `VITE_API_URL` unset → `isServerEnabled` false
→ `AccountDrawerItem` returns null, `initAuth()` returns immediately, `requestSync()` no-ops.
Nothing under `app/lib/server/` may run a network request without that guard.

```
shared/                  types + constants compiled by BOTH tsconfigs — no DOM, no Bun globals
  tracks.ts              ParsedTrack & friends; re-exported by app/types/tracks.ts
  api.ts                 every request/response body — the single wire contract
  constants.ts           MAX_TRACK_BYTES, SYNC_PAGE_SIZE, SESSION_TTL_MS, …
app/lib/server/
  config.ts              API_URL, isServerEnabled, signInUrl
  apiClient.ts           bearer header, ApiRequestError, reports into serverHealth
  authStore.ts           module singleton + useAuth() — the mapStore idiom, not Context
  serverHealth.ts        online/offline/unknown, drives the "Server unavailable" placeholders
  syncEngine.ts          manifest diff → upload/download/tombstone
app/lib/trackHash.ts     SHA-256 over canonical geometry
```

**The alias is `~shared/*`, not `#shared/*`.** A `#`-prefixed specifier is Node/Bun package-imports
syntax and is resolved before tsconfig paths are consulted.

**Two deploy workflows, path-filtered against each other.** `deploy.yml` builds the SPA to GitHub
Pages and now passes `VITE_API_URL` from a repo variable, so the public site does have sync;
`deploy-server.yml` rsyncs `server/` + `shared/` to a Debian VPS (bare Bun + systemd behind Caddy,
releases under `/srv/fogofwalk`, artifacts in `server/deploy/`). `shared/**` fires *both* — the
frontend re-exports it through `app/types/tracks.ts`. Server-optional is still the invariant: no
code path changed, only the build now sets the var, and clearing the variable restores the
server-less bundle. `server.env` is rendered from GitHub secrets on every deploy, so a config
change is a workflow re-run, not an SSH session. `HOST` (new, defaults to `0.0.0.0`) is what lets
the VPS bind loopback-only; Docker and the e2e rig rely on the default.

**`canonicalTrackString` is duplicated on the server** (it recomputes the hash to verify what a
client claims). Changing it is a wire-format change — both sides, same commit, or devices silently
stop deduping.

**Content hash excludes `name`, `id` and `stats`.** Renaming a file must not mint a new track, ids
are per-device `randomUUID()`, and `stats.uniqueDistanceKm` is library-relative — it shifts when an
unrelated track is imported, so it can never be part of an identity. It is also zeroed on upload
and recomputed by the receiving device.

**Downloaded tracks go through `mapStore.ingestTracks()`** — the same function `add-files` uses, so
a synced track is indistinguishable from an imported one. It **joins** the current fog run rather
than calling `startFogRun()`: only the new tracks are posted and the worker's accumulated fog has
to survive. Deletions arriving from a tombstone *do* need the full reset-and-replay, which is why
`syncEngine` hands them to the `setSyncChangeHandler` callback in `home.tsx` instead of doing it
itself — rebuilding fog and fixing `selectedTrackIds` are React concerns.

**`clear-all` is local only.** It resets *this device*; the server copies are untouched. Deleting
server data is a separate, explicit action ("Remove all" in the account dialog). An earlier
version wrote a tombstone per track here, which silently destroyed the user's server library and
made a restore impossible.

**A local-only deletion suspends automatic sync until reload** (`suspendAutoSync`, called by
`clear-all` and by a track delete with the server switch off). Otherwise the next sync — which
`clear-all` in particular triggers from scratch — downloads everything straight back and the
delete undoes itself within seconds. The flag is module state, never persisted, so a reload always
resumes; that is deliberate, so there is no hidden "sync is off" mode to discover how to undo.
`requestSync(reason, { manual: true })` is the only thing that clears it, and only the account
dialog's button passes it. Note this also holds back uploads of anything imported while
suspended.

**Sync has to be *scheduled*, not just triggered.** `startSyncScheduler()` (focus,
`visibilitychange`, `online`, plus a 5-minute poll while visible) is what makes another device's
uploads appear. Sign-in and add-files triggers alone meant a tab open on device B never saw
device A's imports until a reload — which reads as "sync doesn't download anything".

**The manifest cursor must not advance past a failed download.** The window never covers that
track again, so one transient error would drop it permanently. `pooled()` returns a failure count
for exactly this; on download failures the cursor is re-saved at `since`.

**Three deletion semantics, and they are not interchangeable:**

| Action | Server row | Tombstone | Other devices |
|---|---|---|---|
| Delete track, "delete from server" **on** (default) | deleted | yes | delete their copy |
| Delete track, "delete from server" **off** | kept | no | unaffected; this device records the hash in `ignoredHashes` so it is not re-downloaded |
| "Remove all" in the account dialog (`DELETE /api/tracks`) | all deleted | **no** | keep everything; they simply stop syncing it |
| "Clear all" in the drawer | untouched | no | unaffected; this device re-downloads everything |

**Tombstones are applied at most once per device** (`syncState.appliedTombstones`, hash →
`deletedAt`). The server's manifest cursor is an *inclusive* lower bound — that is how a row
written in the same millisecond as a read is not lost — so the newest tombstones are re-served on
the following sync. Applying one twice silently re-deletes a file the user had just re-imported
and refuses to upload it. A tombstone is recorded even when it is not acted on.

**A from-scratch walk (`since === 0`) never deletes local data.** With no cursor there is no prior
shared state to reconcile against, so a tombstone describes a deletion relative to a history this
device no longer has. `clear-all` drops `syncState`, which would otherwise replay every tombstone
the account ever wrote. From-scratch converges toward the *union* of local and server; only
incremental walks propagate deletions.

**`ingestTracks` drops tracks whose `contentHash` is already held** and **returns what it actually
took**. Re-importing a file — or importing one sync had just restored — must not yield two
identical tracks. `add-files` must report *that* count as `newTracksCount`, never the parsed
count: the progress UI waits for a worker `DONE`, and when every track is a duplicate nothing is
posted, so reporting the parsed count strands "Processing 0 of N…" on screen forever. When
nothing was added and nothing failed, `DuplicateTracksDialog` explains why the map did not change.

`ignoredHashes` (in `syncState`) means "this device deliberately stopped syncing this hash" and
suppresses **both** download and upload. The server purge adds every local hash to it — relying on
the cached `serverHashes` to prevent a re-upload would break the moment the cursor resets and that
cache is rebuilt from an empty server.

**Sync is covered by Playwright E2E tests** in `e2e/` — every regression listed above has a spec,
and `e2e/README.md` records which spec fails when each fix is reverted. Add one for any new sync
behaviour; the whole point is that these bugs stopped being caught by hand. Three rig constraints
worth knowing before touching it: the map style request must be *fulfilled* (blocking it hangs the
app, because every control waits on MapLibre's `load`), OAuth is faked in two halves because
Playwright cannot route a redirect hop, and per-test isolation comes from each test claiming its
own login out of `ALLOWED_LOGINS`.

**The progress indicator must never assume work is outstanding.** `isProcessing` is only set when
`mapStore.isFogRunInFlight` says a run is genuinely open. The fog worker can finish before the
action that started it returns — the action still has IDB writes and, when signed in, a network
round trip to get through — and the only thing that clears the flag is the DONE that has already
been and gone. This has stranded "Processing 0 of N…" twice: once via duplicate-import dedupe and
once on delete.

**`DELETE /api/tracks/:hash` returns the tombstone's `deletedAt`**, and the deleting device records
it in `appliedTombstones`. Otherwise its own tombstone comes back in the next manifest as news and
deletes a copy the user has since re-imported.

**Uploads are paced client-side, not just retried.** The server caps uploads per user
(`UPLOAD_RATE_MAX_PER_WINDOW` / `UPLOAD_RATE_WINDOW_MS` in `shared/constants.ts`, enforced only on
`PUT /api/tracks/:hash`), and `app/lib/server/uploadGate.ts` mirrors that window locally so a bulk
import stays under it instead of discovering it by failing. Three things about it are load-bearing:
- The client's budget (`UPLOAD_RATE_CLIENT_BUDGET`) is deliberately **below** the server's. The two
  windows are measured at opposite ends of the request, so the client's view drifts ahead.
- The gate's state is **module-level, not per-run**. `runSync` re-enters `syncOnce` immediately when
  a trigger fires mid-run, and a fresh budget there would re-storm a limiter that is already full.
- A 429 pauses **every** worker (`penalizeUploads`), and `uploadTrack` retries the track in-run up to
  `MAX_UPLOAD_RETRIES`. Backing off per-request would leave the other two `pooled` workers hammering
  a limiter that has already tripped — which is what produced hundreds of
  `[sync] item failed: Too many uploads` lines and left most of a bulk import unsynced until later
  polls. The retry has to be bounded, or a server that keeps saying no parks sync forever.

The hold is published (`useUploadHoldSeconds`) and worded once in `useUploadHoldNotice`, which both
`AccountDialog` and `AccountDrawerItem` render — a silent minute-long stall reads as a hang. Four
things about it:
- **Both hold paths announce, not just the 429 one.** The commonest long hold is the pacer: a fresh
  page spends its whole budget in one burst and then waits out a full window, with the server never
  saying no. Reporting only on `penalizeUploads` left the first sync of a large library showing
  "Syncing 108 of 195…" for a minute — the one number that cannot move — and the notice appeared
  only after a reload, when the client's fresh budget collided with the server's window.
- `noticeUntil` is separate from `penaltyUntil` because they answer different questions: one is why
  the 429 path sleeps, the other is what to tell the user. Holds under `HOLD_NOTICE_MIN_MS` are not
  announced, or the pacer's ordinary sub-second waits would flash a countdown during a healthy sync.
- The notice shows only while `syncStatus.phase === "syncing"`. Once the retries are spent the
  deadline still gates the next attempt, but nothing resumes on its own, so a countdown would
  promise something false.
- The "Sync now" button deliberately keeps saying "Syncing…" through a hold — `AppPage.syncNow` in
  the e2e rig treats any other label as "the run is over".

`useUploadHoldNotice` is its own module rather than a member of `uploadGate`: the gate knows when
uploads resume but nothing about sync runs, and importing `syncEngine` there would close a cycle.

The wait travels in the **JSON error body** (`ApiError.retryAfterMs`), not only in `Retry-After`: the
app is cross-origin to the API, so a response header is unreadable from JS unless CORS exposes it.
The header is still sent, and `app.ts` lists it in `exposeHeaders`, for everything that is not this
client.

**Server tests must be hermetic.** Bun auto-loads `server/.env`, so `tests/setup.ts` assigns the
test environment unconditionally and deletes the GitHub credentials. Using `??=` there meant a
developer with real credentials in `.env` failed the "no providers configured" assertions.

**Session = opaque bearer token in the `prefs` store**, not a cookie: the static client is on a
different origin from the API, and third-party cookies are blocked by Safari and being phased out
by Chrome. The OAuth callback hands over a single-use 60-second code, never the token, so the
long-lived credential never touches a URL, history entry or `Referer`.

**Login is not authorisation.** Anyone who completes OAuth gets a `pending` user row; only
`allowed` reaches `/api/tracks/*`. The UI shows the signed-in name either way and gates only sync.

## Constants (`app/constants/fog.ts`)

```ts
FOG_CLEAR_RADIUS_METERS  = 100   // buffer RADIUS each side — the corridor is ~200 m wide
FOG_EMIT_INTERVAL_MS     = 300   // max fog update frequency
SIMPLIFY_TOLERANCE       = 0.0001   // ~11m — applied to the EMITTED fog polygon
TRACK_SIMPLIFY_TOLERANCE = 0.0005   // ~55m — applied to the TRACK before buffering
BUFFER_STEPS             = 16    // arc segments per buffer; 4× fewer vertices than the default 64
MAP_STYLE_URL           = "https://tiles.openfreemap.org/styles/liberty"
FOG_COLOR               = "#0a0a1e"
FOG_OPACITY             = 0.8
TRACK_COLOR             = "#ff6b35"
LAP_PROFILE_POINTS      = 60    // per-lap elevation profile cap (track's is 300)
MAX_LAPS                = 200   // give up on pathological FIT files above this
LAP_HIGHLIGHT_WIDTH     = 6     // selected-lap line width
```

Not an exhaustive list — `fog.ts` also holds the track line widths/opacities/dim colour,
`TRACK_HIT_WIDTH` (24 px invisible hit-test line, for touch), and the stats tuning constants
`MOVING_TIME_STOPPED_GAP_MS`, `MOVING_TIME_MIN_SPEED_KMH`, `ELEVATION_SMOOTHING_DISTANCE_M` and
`ELEVATION_GAIN_STEP_THRESHOLD_M`. Read the file; every one of them carries a comment explaining
why it has the value it has.
