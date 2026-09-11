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
- Last completed commit: `fa8e423 track refactor progress`
- Next action: integrate the bounded path-aware model/hash slice, then wire the
  service into restore/import/delete callers

## Commit log

| Commit | Slice | Verification |
| ------ | ----- | ------------ |
| — | Baseline before implementation | Client: 78 tests pass; client typecheck passes |
| `fa8e423` | Add the continuation tracker | Client baseline recorded |
| pending | Add revisioned activity-library repository/service foundations | 5 focused tests pass; client typecheck passes |

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

- Preserve the existing shared activity wire identity until a coordinated
  client/server path-aware hash migration is implemented and tested.
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
