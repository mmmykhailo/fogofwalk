# Activities route performance plan

## Scope and outcome

Improve `/activities` for large local libraries without changing sorting,
selection, per-activity editing, bulk editing, offline behavior, or eventual sync.
The route should become usable quickly on a cold direct visit and remain
responsive while sorting and selecting hundreds or thousands of activities.

This plan covers the route and its immediate render, persistence, and sync
paths. Fog geometry and map rendering are out of scope except where shared
activity storage requires a compatibility change.

## Current path and likely costs

These are code-derived hypotheses, not measured results. Phase 0 must establish
which costs dominate before the larger changes begin.

1. A cold `clientLoader` calls `loadActivities()`, which uses IndexedDB
   `getAll()` to clone every complete `ParsedActivity`, including coordinates,
   point timestamps, elevation profiles, and laps. The library page only renders
   a small metadata subset.
2. A stale unique-distance marker blocks the route while the whole library is
   sent to a worker and then every complete activity is written back. The
   activities page does not display unique distance.
3. The loader sorts newest-first, after which the default `date` UI sort copies
   and sorts the same collection again. Changing `?sort=` is a navigation and
   may also revalidate the loader even though the loader does not consume the
   search parameter.
4. `ActivitiesGrid` mounts the entire library. Every card eagerly mounts two
   select trees, two `useFetcher` instances, and an auth subscription. The
   shared public `ActivityCard` also brings public-profile menu/state and server
   visibility code into the local-card path.
5. Toggling one checkbox changes parent state. The grid then recreates every
   card's metric object, selection node, settings node, and inline checkbox
   callback. Entering selection mode additionally unmounts settings controls
   from every card.
6. Selected activities are found by filtering all activities on every selection
   change. The action resolves each submitted id with `Array.find`, making a
   large bulk update `O(selected * activities)`.
7. A metadata edit rewrites each complete activity to IndexedDB and the action
   waits for every paced sync upload before returning. Large bulk edits therefore
   scale with geometry size and network pacing rather than metadata size.

## Phase 0: establish a repeatable baseline

Add a production-build Playwright performance fixture that seeds IndexedDB with
deterministic libraries of 100, 500, and 2,000 activities. Include both a
metadata-heavy case and a geometry-heavy case (representative coordinates,
timestamps, elevation profiles, and FIT laps). Keep this fixture separate from
the functional GPX import helpers so measurements do not include parsing.

Capture at least five runs for each of these scenarios:

- cold direct navigation to `/activities` with current and stale
  unique-distance state;
- warm navigation from `/map` to `/activities`;
- changing each sort option;
- selecting the first activity, selecting ten more, and clearing selection;
- a one-item and a 100-item activity-type update;
- scrolling from the first card to the end of the currently rendered list.

Record median and p95 loader duration, first-card paint, time until sort and
selection controls respond, interaction duration, long tasks, DOM element/card
counts, and JS heap after settling. Add temporary or development-only
`performance.mark()` boundaries around IndexedDB load, unique-distance repair,
sorting, and React commit work so cold-load time can be attributed rather than
guessed.

Use the baseline to set device-specific absolute budgets. The implementation
must also meet these invariant targets:

- initial mounted card count is bounded independently of library size;
- a sort-only query-string change performs no IndexedDB read or unique-distance
  work;
- each sort performs at most one full collection sort;
- after selection mode is entered, another checkbox changes only that card and
  the selection header, rather than recommitting every card;
- unique-distance repair is not on the `/activities` first-render critical path;
- metadata persistence is proportional to the number and size of metadata
  changes, not the changed activities' coordinate counts.

Commit the fixture and a short baseline table before optimization so later
changes can be compared under the same data and browser settings. Avoid a hard
CI timing gate initially; retain deterministic structural assertions and report
timings until runner variance is known.

## Phase 1: remove redundant route and collection work

1. Make one layer responsible for ordering. Keep `mapStore.activities` in its
   existing canonical chronological order, return that stable collection from
   the loader, and let `ActivitiesGridWithSorting` perform the single requested
   sort. Do not sort newest-first in both the loader and component.
2. Export a route `shouldRevalidate` that skips revalidation only when the
   pathname is unchanged and the navigation changes the valid `sort` search
   parameter. Preserve default revalidation for actions and unrelated
   navigations. Add a route test proving sort navigation cannot suppress an
   action-driven refresh.
3. Build an `activityById` map once per activities collection. Use it for
   selected-activity derivation and in `clientAction`, reducing id resolution to
   `O(activities + selected)`. Preserve parser-level id deduplication and the
   action's all-or-nothing missing-id validation.
4. Extract a shared, coalescing `ensureUniqueDistancesCurrent()` operation.
   `/stats` and any actual unique-distance consumer must await it;
   `/activities` may start it after useful content is available but must not
   await it. Concurrent consumers should join the same promise, and failures
   must leave the marker stale so a later attempt retries. Confirm that a direct
   `/activities` visit followed immediately by `/stats` never displays fallback
   distance as current.
5. Keep `initAuth()` non-blocking and preserve the no-server/no-network
   behavior when `VITE_API_URL` is unset.

Verify this phase with unit tests for revalidation decisions, sort equivalence,
id lookup/missing-id atomicity, and unique-distance coalescing. Re-run the cold
and warm navigation scenarios and retain the before/after table.

## Phase 2: bound and isolate rendering work

### 2.1 Render a bounded list

Render the globally sorted collection in progressive pages, starting with 48
cards and exposing an explicit, keyboard-accessible **Load more activities**
button. Validate 48 against mobile and desktop measurements and adjust if a
smaller batch materially improves first interaction. Sorting still applies to
the full library and resets the visible window to the first page. The count and
button must announce how many activities remain.

Prefer progressive paging over fixed-height virtualization initially: the grid
has responsive columns and variable-height cards, so a virtualizer would add
measurement and focus-restoration complexity. If the heap/DOM budget still
fails after paging, replace already-passed pages with a variable-size,
multi-column virtualizer while preserving keyboard focus, back-navigation scroll
restoration, and stable activity keys.

Use `content-visibility: auto` only as a supplementary paint/layout improvement;
it does not prevent React hooks and component trees from mounting and therefore
is not a substitute for bounded rendering.

### 2.2 Give each local card a stable render boundary

1. Split the shared card into a presentation-only card frame plus separate local
   and public wrappers. The local route should not import public-profile hide
   behavior, menu code, or per-card `isHiding` state.
2. Extract a memoized `LocalActivityCard` that accepts a stable activity summary,
   `isSelected`, and stable callbacks. Do not construct the metric object and
   React-node props inside the grid loop.
3. Replace the inline selection closure with an id-bearing stable handler (or a
   stable callback created inside the memoized row). Confirm with React Profiler
   that a second selection toggle does not render unchanged rows.
4. Read auth once in `ActivitiesGridWithSorting` and pass the small capability
   value required by visible rows. Avoid one external-store subscription per
   activity.
5. Keep row controls mounted only for the bounded visible page. Entering bulk
   selection may still update visible rows to hide settings, but it must not do
   work proportional to the full library.

Add component or E2E assertions for the initial card bound, Load more behavior,
global sort order across page boundaries, checkbox labels, focus behavior, and
selection persistence as additional pages are revealed. Existing bulk-settings
coverage must continue to pass unchanged in meaning.

## Phase 3: make the cold data path metadata-sized

Proceed only if Phase 0/2 measurements show IndexedDB cloning or heap retention
is still a material part of cold-route latency. This is a storage migration and
should land separately from rendering changes.

1. Introduce an `ActivitySummary` contract containing only fields used by this
   route: id, name, start time, activity type, content hash/publicity, and the
   displayed distance/duration/elevation/speed values.
2. Add a versioned `activity-summaries` IndexedDB store keyed by activity id.
   Populate it in the database upgrade cursor and update it atomically alongside
   the full activity store for imports, downloads, deletions, and migrations.
   A failed or interrupted migration must fall back to deriving summaries from
   full activities; never show an empty library merely because the summary store
   is incomplete.
3. Add an explicit hydration state rather than using
   `mapStore.activities.length === 0` to mean both "not loaded" and "loaded but
   empty." A direct visit to `/activities` should load summaries only and should
   not retain geometry in React Router loader data or `mapStore`.
4. Move mutable per-activity settings to a small keyed metadata record, or add a
   dedicated transactional settings update API. A publicity/type edit must not
   rewrite coordinates, timestamps, profiles, or laps. Overlay metadata when a
   complete activity is loaded.
5. When `/map`, `/stats`, fog processing, sharing, or sync needs full activities,
   load them through one coalesced full-library hydrator and preserve the
   existing read-time migrations. Do not let a summary object reach the fog
   worker or any statistics API typed for `ParsedActivity`.

Migration verification must cover upgrading an existing v3 database, an empty
database, missing/corrupt summaries, interrupted upgrade recovery, import,
sync download, local delete, clear-all, single/bulk metadata edits, and a direct
`/activities` -> `/map` navigation. Keep the distinction between activity and
fog simplification untouched.

## Phase 4: decouple bulk metadata edits from network latency

The local action should finish after the metadata transaction succeeds. Persist
a durable queue of content hashes needing metadata upload, then let the existing
sync engine drain and coalesce it through its module-level pacing/429 gate.
Request sync once for the batch instead of once per activity. A failed upload
must remain queued for a later trigger; do not report a local edit as failed
after it has already been committed locally.

If the server API makes full activity upload unavoidable, compare a batch
metadata endpoint with background full uploads and choose based on the Phase 0
100-item result. A metadata endpoint is preferable when request count or
structured serialization remains dominant, but it requires shared-contract and
server tests in the same change.

Extend Playwright coverage to prove that bulk edits return promptly while
offline, persist across reload, later sync to another device, respect global
rate-limit holds, and remain a no-op at the network layer in server-disabled
builds.

## Rollout order and stop conditions

Land the work in independently measurable changes:

1. benchmark fixture and baseline;
2. redundant work and unique-distance critical-path removal;
3. bounded rendering;
4. memoized local-card boundary and auth subscription reduction;
5. summary/settings storage migration, only if cold storage remains material;
6. durable background metadata sync, only if bulk-action latency remains
   material.

After each change, run `bun run typecheck`, the focused Bun tests, the activities
Playwright spec, and the matching performance scenarios in a production build.
Record regressions as well as wins. Stop before Phases 3 or 4 if the absolute
budgets established in Phase 0 are already met; those phases carry migration
and cross-device complexity that should be justified by measured results.

## Definition of done

- The performance report demonstrates that the agreed cold-load, interaction,
  DOM, and heap budgets pass for the 2,000-activity fixture.
- Sorting, per-card edits, bulk selection/editing, persistence, and sync retain
  their existing behavior and accessibility.
- Sort-only navigation causes no loader/storage work and no duplicate sort.
- Initial render and selection commits are bounded by the visible page, not the
  whole library.
- `/activities` never waits for unique-distance repair.
- If Phase 3 lands, direct library visits do not clone or retain activity
  geometry; metadata edits do not rewrite geometry.
- If Phase 4 lands, local metadata commits do not wait for network pacing and
  queued updates survive reload/offline periods.
- The server-optional invariant remains intact: with no `VITE_API_URL`, all
  library behavior works without issuing network requests.
