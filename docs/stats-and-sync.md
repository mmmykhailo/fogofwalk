# Statistics and optional sync

This reference expands on [AGENTS.md](../AGENTS.md). It covers two areas whose correctness depends on data ownership and cross-device semantics.

## Statistics

`routes/stats.tsx` loads activities client-side and calls the pure aggregators in `lib/statsAggregator.ts`: lifetime totals, weekly bars, streaks, personal records, and library-wide unique distance. Unique distance is grid deduplication across the whole library, not a sum of activity values.

Unique distance is computed in `workers/uniqueDistanceWorker.ts`, then persisted per activity together with an ordered-library cache marker. Restore and the Stats page reuse a current cache; library mutations recompute off the main thread and persist every affected value.

Use `avgSpeedKmh` for elapsed-time speed and `avgMovingSpeedKmh` for moving-time speed. `fastestAvgSpeed` and `fastestPace` deliberately use different definitions. Streaks use local calendar dates. New temporal consumers should use `ParsedActivity.startedAtMs`, not re-derive it from coordinate timestamps.

Chart colors are `--chart-1` through `--chart-5` in `app/app.css`; activity dots and weekly bars both use `--chart-1`.

## Optional sync server

`server/` is an independent Bun package. The static app must work when `VITE_API_URL` is absent: server surfaces disappear and code in `app/lib/server/` must not issue a request without `isServerEnabled`. Shared wire types live in `shared/`; use the `~shared/*` alias.

Downloads go through `mapStore.ingestActivities()` so imported and synced activities follow the same dedupe and fog-processing path. It returns only accepted activities; callers must use that count for UI progress. Content hashes exclude names, local IDs, and stats. The canonical hash implementation is duplicated on the server, so changes are wire-format changes and must land together.

### Deletion and cursor rules

- Clear all is local only; it preserves server copies. Removing all server data is a separate explicit account action.
- A local-only delete records its hash in `ignoredHashes` and suspends automatic sync until reload. A manual sync clears that suspension.
- Tombstones are applied once per device. A from-scratch sync (`since === 0`) never deletes local activities.
- Do not advance the manifest cursor beyond a failed download; that item otherwise falls outside every future window.

### Upload behavior

The client paces uploads below the server limit. Gate state is module-level, and a 429 pauses every uploader before bounded retries. Upload holds are surfaced only while an active sync is running. The retry delay is included in the JSON error body because the API is cross-origin.

Sync scheduling includes focus, visibility, online, and a visible-page poll; an upload trigger alone is insufficient for a second device to receive new activities. Add or update the Playwright sync coverage for any changed sync behavior.
