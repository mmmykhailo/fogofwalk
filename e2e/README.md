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

Six specs, one per area of sync behaviour:

| Spec                    | Covers                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`          | local-account sign-in, session persistence, pending-vs-allowed, log out, delete account                                     |
| `activity-sync.spec.ts` | upload, download onto a second device, content-hash dedupe, the scheduler, manifest paging                                  |
| `deletion.spec.ts`      | the three deletion semantics — per-activity with and without the server switch, purge-all, clear-all                        |
| `suspension.spec.ts`    | auto-sync suspension after a local-only delete, and that only a manual sync clears it                                       |
| `serverless.spec.ts`    | the `VITE_API_URL`-unset build, fog-cache/worker convergence, and fog updates during map-style changes                      |
| `rate-limit.spec.ts`    | a 429 upload is retried inside the same sync run, the retry is bounded, and both account surfaces count an upload hold down |

## How the rig fits together

`global-setup.ts` starts the real server on a temporary `DATA_DIR` with local
test accounts enabled. Each normal sync test creates an isolated account, makes
its access request through the UI, and has the dedicated local administrator
approve it through the real admin endpoint.

Playwright's `webServer` starts two client dev servers: one with `VITE_API_URL`
pointing at the test API, one with it unset (the GitHub Pages build).

The E2E client also uses a three-upload, three-second local pacing window. It
exercises the same upload-hold path as production's 108-upload, one-minute
window without making the suite idle for a minute. The real server keeps its
production rate limit, so the pacing test still proves that no 429 occurs.

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
and check the matching spec fails — all six below were verified to do so:

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
