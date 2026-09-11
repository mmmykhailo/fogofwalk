# Activity pipeline refactor progress

Status: in progress

This file is the continuation point for the implementation of
`activity-pipeline-refactor-plan.md`. Each completed slice is committed on its
own. The two plan documents and the focused architecture docs were present in
the worktree before implementation; unrelated edits to those files remain
untouched.

## Current state

- Branch: `refactor/fog-processing`
- Started: 2026-09-11
- Current phase: Phase 4/5/6 — projections, bounded fog, and sync effects
- Last completed commit: `0960111 queue local activity sync effects`
- Current working slice: finish sync scheduling/leadership and projection
  ownership, then add route-level terminal recovery states
- Next action: add a cross-tab sync lease/scheduler seam and migrate unique
  distance plus fog work behind revision-keyed coordinators

## A1 activity contract slice

- Added shared `ActivityGeometry`, `ActivityDraft`, and `CanonicalActivity`
  types while retaining legacy `ParsedActivity.coordinates`.
- Added shared geometry normalization with typed rejection reasons, timestamp
  alignment checks, duplicate coalescing, and discontinuity-preserving splits.
- Added v2 path-aware identity serialization and client/server legacy-hash
  compatibility for single-path activities.
- Added server payload and upload-route validation for canonical multi-path
  payloads.
- Focused tests pass; no excluded pipeline files were intentionally changed.
- This slice is committed independently; legacy flat callers remain readable
  during the migration.

## B2 fog input sanitizer slice

- Added pure `app/lib/fog/engine/input.ts` handling legacy flat and canonical
  path-aware geometry.
- Invalid/non-finite points split paths; near duplicates coalesce; disconnected
  source paths remain disconnected; teleports use a configurable 250 km safety
  threshold; seam crossings are split into local `[-180, 180]` pieces.
- Pole-adjacent latitudes clamp to the Web Mercator limit, and deterministic
  per-path/total technical point budgets prevent unbounded engine input.
- Input simplification uses `ACTIVITY_SIMPLIFY_TOLERANCE` only; emission
  simplification remains a separate downstream concern.
- Focused tests pass; this slice is committed independently.

## A2/A3 import and library integration slice

- Added a format registry with extension and MIME classification and routed the
  parser entry point through it.
- Added bounded, transport-independent import processing with per-file and
  per-activity terminal outcomes, cancellation before commit, deterministic
  commit ordering, normalization/hash validation, and one operation id per
  accepted batch.
- Home, activities, and stats routes now read through the revisioned library;
  clear/delete/import commands no longer assign the canonical activity array
  directly. Cross-tab refreshes publish projection changes.
- The canonical commit remains independent of unique-distance, fog-cache, and
  sync side effects; those projections are scheduled after the commit.
- Share-target files are retained until a successful terminal import result and
  remain addressable for retry when parsing or storage fails. Visibility edits
  also go through the library projection instead of mutating its array.
- Focused tests and client typecheck pass; this slice is committed as
  `60e9047`.

## B1/B3/B4/B5 fog protocol and representation slice

- Added a versioned worker protocol with request-relative progress, generation
  and library-revision checks, append-base validation, terminal replies, and
  malformed-request rejection.
- Extracted `FogEngine` from worker globals with injected scheduler yielding,
  per-activity diagnostics, cancellation checkpoints, and authoritative
  revisioned snapshots.
- Sanitized and buffered each disconnected path independently, then converted
  the inverse into bounded world partitions with hole-free triangulation and a
  validated world fallback. Fill-mode loop behavior remains covered.
- Versioned fog cache identity by library revision, mode, algorithm, and
  partition scheme; the map bridge accepts only current validated snapshots and
  keeps the latest snapshot through source/style gaps.
- Focused fog, protocol, state, and client typecheck checks pass; this slice is
  committed as `2378a7f`.

## C1 pure sync planner slice

- Added a transport-free, deterministic planner for local/remote metadata,
  uploads/downloads, ignored hashes, resurrection, tombstones, conflicts, and
  guarded cursor advancement.
- Added focused table/race tests; 22 planner tests pass. The planner is not yet
  wired to durable outbox execution.

## Fog coordinator slice

- Added a transport-free coordinator that coalesces newer library revisions,
  chooses exact-base appends versus rebuilds, drops stale replies, acknowledges
  cancellation, and bounds worker recovery to one rebuild attempt.
- Added four focused coordinator tests; this slice is committed as `ce7255d`.

## C3 sync transport validation slice

- Added runtime validation for manifest metadata, tombstones, path/timestamp
  relationships, activity statistics, payload hashes, response sizes, and
  idempotent upload/delete transport effects.
- Added three focused transport tests; this slice is committed as `db6eeec`.

## C2 durable sync repository slice

- Added dedicated IndexedDB `sync-state` and `sync-outbox` stores with
  migration indexes, legacy cursor migration, immutable state snapshots, and
  lease-based outbox claiming.
- Added retryable/permanent failure metadata, idempotent dedupe, crash lease
  takeover, and an atomic cursor-plus-outbox completion seam.
- Kept the saved-point fields in sync state while separating activity cursor
  storage from the legacy preference record; sign-out and clear-local remove
  both cursor copies.
- Added six focused repository tests; this slice is committed as `43c7b6f`.

## Sync engine transport/library seam

- Activity hash backfill, remote downloads, remote metadata, and tombstone
  deletes now use the revisioned `ActivityLibrary` instead of direct canonical
  array or IndexedDB mutation.
- Activity manifest and payload parsing, hash verification, compression, and
  oversize rejection now run through the validated sync transport.
- The existing inline reconciliation still remains as a compatibility façade;
  the page-wise executor is the next ownership boundary.
- Client tests and typecheck pass; this slice is committed as `af7b9cc`.

## C4 page-wise sync executor slice

- Added an injectable executor that fetches one validated manifest page at a
  time, plans it purely, leases durable effects, stages remote changes, and
  commits only a safe cursor plus completed leases.
- Remote downloads, metadata updates, and tombstones publish one
  `ActivityLibrary` command per page; failed remote effects keep the cursor at
  the last committed boundary while safe siblings remain durable.
- Retryable failures receive bounded exponential retry times with jitter;
  permanent failures remain visible in the outbox and never become known server
  hashes. Non-advancing pages fail before effects are created.
- Added seven executor tests and a targeted-claim repository test; this slice
  is committed as `ed8bc4e`.

## Sync executor integration slice

- `syncEngine` now delegates activity manifest planning, downloads, metadata,
  tombstones, cursor advancement, retry state, and remote library commits to
  `ActivitySyncExecutor`.
- The old whole-manifest reconciliation and direct activity-array/storage
  mutations were removed; saved-point reconciliation remains on its separate
  compatibility cursor while its own repository split is completed.
- Remote additions invalidate the render cache and enter the existing fog
  projection queue after their canonical commit.
- Client tests and typecheck pass; this slice is committed as `37adff0`.

## Atomic library/outbox slice

- Activity-library commits can carry durable sync-outbox inputs. IndexedDB now
  commits activities, `library-meta`, and those effects in one transaction;
  memory repositories exercise the same merge/dedupe behavior.
- Shared outbox normalization/merge helpers keep standalone sync enqueue and
  library-coupled enqueue semantics identical.
- The caller migration and executor handling of local effects remain the next
  slice; no route mutation has been changed by this commit yet.
- Focused repository tests and client typecheck pass; this slice is committed
  as `e002ce4`.

## Local sync effects and saved-point state slice

- File imports, activity-type edits, visibility edits, and delete-everywhere
  now attach upload/delete effects to the canonical library commit when sync is
  configured. The activity outbox is durable before the route reports the
  mutation complete.
- The page-wise executor drains local upload/delete effects independently of
  manifest pages, records server tombstones and known-hash changes atomically
  with effect completion, and preserves retry/permanent failure states.
- Saved-point cursor, known IDs, tombstone memory, and outbound IDs now live in
  a dedicated state shape with one-way migration from the legacy shared record.
- Focused sync/repository/storage tests and client typecheck pass; this slice is
  committed as `0960111`.

## Path-aware adapter and render slice

- GPX tracks remain one activity and their track segments remain disconnected
  paths; routes remain separate activities. FIT exposes its normal single path.
- Multi-path statistics sum per-path distances/elevation/moving time without
  inventing a segment between path endpoints.
- Map GeoJSON emits a single-path `LineString` or a multi-path `MultiLineString`;
  the transitional fog worker buffers each path independently.
- Legacy flat coordinates remain readable while new parser output carries
  path-aligned timestamps and a compatibility alias.
- Focused tests and client typecheck pass; this slice is committed independently.

## Commit log

| Commit    | Slice                                                                | Verification                                                     |
| --------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| —         | Baseline before implementation                                       | Client: 78 tests pass; client typecheck passes                   |
| `fa8e423` | Add the continuation tracker                                         | Client baseline recorded                                         |
| `7f6c149` | Add revisioned activity-library repository/service foundations       | 5 focused tests pass; client typecheck passes                    |
| `15eca51` | Add A1 path-aware activity contract                                  | Shared/client/server focused tests pass; server typecheck passes |
| `e977389` | Preserve disconnected paths through adapters, stats, map, and worker | 21 focused tests pass; client typecheck passes                   |
| `84ba4b5` | Add B2 fog input sanitizer                                           | 10 focused tests pass; client typecheck passes                   |
| `60e9047` | Route activity changes through the serialized library                | 30 focused tests pass; client typecheck passes                   |
| `2378a7f` | Add bounded fog worker engine, protocol, and cache handoff           | 48 focused tests pass; client typecheck passes                   |
| `ce7255d` | Add the revisioned fog coordinator                                   | 4 focused tests pass                                             |
| `8c09534` | Close share-queue acknowledgement and visibility mutation seams      | Client typecheck passes                                          |
| `db6eeec` | Add pure sync planner and validated transport                        | 29 focused tests pass; client typecheck passes                   |
| `43c7b6f` | Add durable sync repository and outbox                                | 6 repository tests pass; client typecheck passes                 |
| `af7b9cc` | Route sync through the revisioned library and validated transport     | 152 client tests pass; client typecheck passes                    |
| `ed8bc4e` | Add page-wise resumable sync executor                                | 14 sync executor/repository tests pass; client typecheck passes  |
| `37adff0` | Wire the page-wise executor into the sync scheduler                   | Client tests and typecheck pass                                 |
| `e002ce4` | Commit library mutations with durable outbox effects                  | 8 repository tests pass; client typecheck passes                 |
| `0960111` | Queue local activity sync effects and split saved-point state            | 20 focused tests pass; client typecheck passes                   |

## Phase checklist

- [ ] Phase 0 — baseline diagnostics, safe reproducer/geometry ADR, and
      performance measurements
- [x] Phase 1 — characterization tests, fault seams, callable fog engine and
      planner façade
- [x] Phase 2 — versioned activity repository and serialized library service
- [ ] Phase 3 — normalized, bounded import batch service and share queue
- [ ] Phase 4 — revision-keyed projection scheduling and fog recovery
- [ ] Phase 5 — bounded fog representation, validation, and cache handoff
- [ ] Phase 6 — pure sync planner, durable outbox, validated transport, and
      page-wise executor
- [ ] Phase 7 — route/UI cleanup and terminal recovery states
- [ ] Phase 8 — rollout gates, cache invalidation, and removal of old paths

## Working decisions

- Preserve legacy flat activity identity while the coordinated client/server
  path-aware hash migration is rolled out; canonical v2 payloads are now
  accepted alongside v1.
- Preserve the four existing deletion semantics and render-only FIT laps.
- Keep all user-authored changes that predate this implementation isolated from
  refactor commits unless a later migration explicitly requires them.
- Do not add product-level activity/file/point caps before measurements; any
  technical safety limit must be typed and user-visible.

## Resume notes

When continuing, inspect this file and `git status` first. Re-run the focused
tests for the last slice before changing the next ownership boundary. Update the
commit table, checklist, and next action in the same commit as the relevant
implementation change.
