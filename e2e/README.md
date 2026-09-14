# E2E suite

Playwright, driving the real UI in a real browser against the real sync server.
Everything below the browser is genuine: real HTTP, real IndexedDB, real SQLite,
real content hashing. Sync-capable specs create local test accounts through the
same UI used in development.

```bash
cd e2e
bun install
bunx playwright install chromium   # once
bun run test                       # headless
bun run test:ui                    # Playwright UI mode (pick tests, watch, time-travel)
bun run test:headed                # watch it happen
```

Or from the repo root: `bun run test:e2e`.

## What is covered

Nineteen specs cover local data, import and fog processing, map interactions,
profiles, and sync:

| Spec                                  | Covers                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `activities-bulk-settings.spec.ts`    | selecting, confirming, persisting, and syncing bulk activity-type and visibility edits                              |
| `activities-performance.spec.ts`      | summary-only loading, sorting, pagination, bounded DOM size, metadata writes, and summary-store recovery            |
| `activity-metadata.spec.ts`           | optimistic activity metadata edits, rollback, cross-tab propagation, and avoiding unnecessary geometry work         |
| `activity-progress.spec.ts`           | unified parser/save/fog progress, accessible bars, persistence, terminal states, and mode-toggle generations        |
| `activity-sync.spec.ts`               | uploads, second-device downloads, content-hash dedupe, metadata sync, scheduling, and manifest paging               |
| `auth.spec.ts`                        | local-account sign-in, session persistence, pending-vs-allowed access, log out, and account deletion                |
| `deletion.spec.ts`                    | per-activity local/everywhere deletion, server purge, clear-all, re-imports, and tombstone semantics                |
| `fog-visual.spec.ts`                  | positive-mask rendering without triangle seams and stable corridor edges during animated zoom                       |
| `fog-worker.spec.ts`                  | real-worker revision identity, cache acceptance, partial rebuilds, append blocking, and watchdog recovery           |
| `map-dialog-dismissal.spec.ts`        | dialog dismissal with fog on/off and protection from delayed public saved-point responses                           |
| `map-interaction-performance.spec.ts` | bounded map work for large libraries, overlay combinations, desktop/mobile gestures, and pointer-move coalescing    |
| `map-overlay-blur.spec.ts`            | draggable-dialog blur and compact-control map fallbacks                                                             |
| `paths.spec.ts`                       | keeping disconnected activity paths separate in map and share rendering                                             |
| `public-profile.spec.ts`              | bounded profile previews, paginated public activities, owner actions, and visibility changes                        |
| `rate-limit.spec.ts`                  | bounded 429 retries and visible countdowns for server-directed and self-paced upload holds                          |
| `saved-points.spec.ts`                | saved-point editing, public links, atomic overlap rendering, and newest-created hit priority                        |
| `serverless.spec.ts`                  | no-API builds, offline imports, local metadata, fog restore/style changes, and keeping the map mounted across pages |
| `suspension.spec.ts`                  | suspension and explicit/reload resume after clear-all or local-only deletion                                        |
| `sync-cancellation.spec.ts`           | sign-out/account-switch cancellation and account isolation for activity effects and saved-point sync state          |

## How the rig fits together

`global-setup.ts` starts the real server on a temporary `DATA_DIR` with local
test accounts enabled. Each normal sync test creates an isolated account, makes
its access request through the UI, and has the dedicated local administrator
approve it through the real admin endpoint.

Playwright's `webServer` starts two client dev servers: one with `VITE_API_URL`
pointing at the test API, one with it unset (the GitHub Pages build).

The self-pacing regression test installs a three-upload, ten-second client
window before the app loads. It exercises the same upload-hold path as
production's 108-upload, one-minute window without making the suite idle for a
minute. The real server keeps its production rate limit, so the test still
proves that self-pacing avoids a 429.

## Three things that are not obvious

**Access approval is part of setup.** The regular `app` fixture uses the local
account form, submits a real access request, then a dedicated local administrator
approves that request through the admin API. The app reloads before sync begins,
so every sync spec exercises the same gate as development. A second device signs
in as the already-approved account; the auth spec's unlisted account deliberately
uses no approver and remains pending.

**The map must load or nothing is testable.** Every control is gated behind
MapLibre's `load` event, which needs the style JSON. Tests fulfil that one
request with a minimal offline style and abort every other tile host; blocking
the style instead hangs the whole app. Chromium runs with SwiftShader flags
because a missing WebGL context throws the map into the error boundary.

**Isolation is per-login.** Each test claims a distinct local login, so tests
never see each other's activities — every store method is scoped by user id.
Workers own disjoint slices of the pool.

## Keeping it honest

The suite exists because sync shipped several regressions in a row. Re-break one
and check the matching spec fails — every case below has been verified to do so:

| Break                                                                 | Spec that must fail                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| dropping the 429 retry in `uploadActivity`                            | a 429 is retried within the same sync                                |
| dropping `announceHold` from the pacing branch of `acquireUploadSlot` | self-paced holds are announced too                                   |
| `useUploadHoldNotice` not rendered by the account surfaces            | the account surfaces explain the hold and count down                 |
| `newActivitiesCount: allActivities.length` in `add-files`             | re-importing the same files … does not hang                          |
| `clear-all` propagating deletions to the server                       | clear all leaves the server untouched                                |
| dropping `appliedTombstones` freshness check                          | a deleted activity can be re-imported                                |
| `isFromScratch = false`                                               | an activity re-imported after a clear-all survives its old tombstone |
| `setIsProcessing(activityCount > 0)` without `isFogRunInFlight`       | deleting with the server switch on                                   |
| missing account ownership on local outbox effects                     | switching accounts does not upload the previous account's activity   |
| shared saved-point cursor or ownership state                          | saved-point cursors and ownership stay isolated across accounts      |
| separate saved-point centre/body layers or `updatedAt`-based stacking | saved-point overlap rendering and newest-created hit priority        |
