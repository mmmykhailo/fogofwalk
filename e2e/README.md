# E2E suite

Playwright, driving the real UI in a real browser against the real sync server.
Everything below the browser is genuine: real HTTP, real IndexedDB, real SQLite,
real content hashing. Only GitHub is faked.

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

Five specs, one per area of sync behaviour:

| Spec | Covers |
|---|---|
| `auth.spec.ts` | sign-in through the fake IdP, session persistence, pending-vs-allowed, log out, delete account |
| `track-sync.spec.ts` | upload, download onto a second device, content-hash dedupe, the scheduler, manifest paging |
| `deletion.spec.ts` | the three deletion semantics — per-track with and without the server switch, purge-all, clear-all |
| `suspension.spec.ts` | auto-sync suspension after a local-only delete, and that only a manual sync clears it |
| `serverless.spec.ts` | the `VITE_API_URL`-unset build: no account surfaces, no requests, everything else still works |

## How the rig fits together

`global-setup.ts` starts two processes and leaves them up for the whole run:

- the **fake IdP** (`fixtures/fake-idp.ts`) — stands in for GitHub's token
  endpoint and user API;
- the **real server**, on a temp `DATA_DIR`, under
  `bun --preload fixtures/stub-github.ts`.

Playwright's `webServer` starts two client dev servers: one with `VITE_API_URL`
pointing at the test API, one with it unset (the GitHub Pages build).

## Three things that are not obvious

**OAuth is faked in two halves.** `arctic` hardcodes github.com, and the token
exchange happens server-side where Playwright cannot reach. So the preload
rewrites the server's two outbound calls to the fake IdP, and the browser leg is
handled by intercepting `/api/auth/*/start` — *not* the github.com navigation,
because Playwright cannot route a request reached through a redirect. The real
callback, state-cookie validation, allowlist promotion and session minting all
run untouched.

**The map must load or nothing is testable.** Every control is gated behind
MapLibre's `load` event, which needs the style JSON. Tests fulfil that one
request with a minimal offline style and abort every other tile host; blocking
the style instead hangs the whole app. Chromium runs with SwiftShader flags
because a missing WebGL context throws the map into the error boundary.

**Isolation is per-login.** The server boots with a large `ALLOWED_LOGINS` pool
and each test claims one, so tests never see each other's tracks — every store
method is scoped by user id. Workers own disjoint slices of the pool.

## Keeping it honest

The suite exists because sync shipped several regressions in a row. Re-break one
and check the matching spec fails — all five below were verified to do so:

| Break | Spec that must fail |
|---|---|
| `newTracksCount: allTracks.length` in `add-files` | re-importing the same files … does not hang |
| `clear-all` propagating deletions to the server | clear all leaves the server untouched |
| dropping `appliedTombstones` freshness check | a deleted track can be re-imported |
| `isFromScratch = false` | a track re-imported after a clear-all survives its old tombstone |
| `setIsProcessing(trackCount > 0)` without `isFogRunInFlight` | deleting with the server switch on |
