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
- Current phase: Phase 1/2 — contracts and activity-library ownership
- Last completed commit: `7f6c149 add activity library foundations`
- Next action: wire the committed path-aware contract into the import adapters,
  then finish migrating restore/import/delete callers

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
- This slice is ready to commit independently; legacy flat callers remain
  readable during the migration.

## Commit log

| Commit    | Slice                                                          | Verification                                                     |
| --------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| —         | Baseline before implementation                                 | Client: 78 tests pass; client typecheck passes                   |
| `fa8e423` | Add the continuation tracker                                   | Client baseline recorded                                         |
| `7f6c149` | Add revisioned activity-library repository/service foundations | 5 focused tests pass; client typecheck passes                    |
| pending   | Add A1 path-aware activity contract                            | Shared/client/server focused tests pass; server typecheck passes |

## Phase checklist

- [ ] Phase 0 — baseline diagnostics, safe reproducer/geometry ADR, and
      performance measurements
- [ ] Phase 1 — characterization tests, fault seams, callable fog engine and
      planner façade
- [ ] Phase 2 — versioned activity repository and serialized library service
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
