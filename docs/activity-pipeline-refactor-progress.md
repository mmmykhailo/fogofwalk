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
- Last completed commit: `ce7255d add fog coordinator`
- Current working slice: sync planner and transport validation (focused tests
  pass)
- Next action: add the durable sync repository/outbox and connect the planner
  to a resumable executor

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
- Added three focused transport tests; this slice is ready to commit with the
  planner.

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
| pending   | Close share-queue acknowledgement and visibility mutation seams      | Client typecheck passes                                          |
| pending   | Add pure sync planner and validated transport                        | 29 focused tests pass; client typecheck passes                   |

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
