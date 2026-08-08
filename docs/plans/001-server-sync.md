# Plan 001 — Optional sync server: GitHub OAuth, allowlist, track synchronisation

Status: approved, not yet implemented.

## Context

Fog of Walk is today a pure client-side SPA (`react-router.config.ts` → `ssr: false`, deployed
to GitHub Pages via `.github/workflows/deploy.yml`). There is no server, no auth, no network
calls beyond map tiles. All state lives in IndexedDB (`app/lib/storage.ts`) and localStorage.

The goal is to grow this into a Strava-like social app **without giving up the server-less
property**. So the server is an *optional, separately deployed* component: when the client is
built without `VITE_API_URL`, nothing about today's behaviour changes — no login button, no
network, GitHub Pages build unaffected. When the variable is set, the same static bundle gains
sign-in and background track sync.

This first increment delivers: GitHub OAuth (provider-pluggable), a default-deny allowlist,
owner-only track sync with content-hash dedupe, and the account UI in `MoreDrawer`.

**Decisions taken up front:**

- Server = separate Hono app in `server/`, **Bun-only runtime** (no Node compatibility target).
- Storage = SQLite metadata + gzipped geometry blobs on disk, behind a swappable adapter.
- Session = opaque bearer token in IndexedDB (cross-origin safe; third-party cookies are dead).
- Account deletion erases server data only; the device keeps its local IDB copy.
- Client and server **share types** through a `shared/` module — type-only, no runtime coupling.

---

## 1. Repo layout

```
shared/                     types + pure constants imported by BOTH sides
  tracks.ts                 ParsedTrack, TrackStats, TrackLap, ElevationPoint, TrackCoords, FogMode
  api.ts                    wire DTOs: ServerUser, MeResponse, ManifestPage, TrackMeta,
                            TrackUploadPayload, AuthProviderInfo, ApiError
  constants.ts              MAX_TRACK_BYTES, SYNC_PAGE_SIZE, SESSION_TTL_MS, HANDOFF_TTL_MS

server/                     independent Bun package (not a workspace of the client)
  src/
    index.ts                Hono app + CORS, exported as `default { fetch, port }` for Bun.serve
    env.ts                  typed env parsing, fails fast on missing secrets
    auth/
      providers/index.ts    provider registry — add a file, add a line
      providers/github.ts   GitHub OAuth via arctic
      routes.ts             /start, /callback, /exchange, /logout
      session.ts            token mint / hash / verify / rotate
      middleware.ts         requireSession, requireAllowed
    tracks/routes.ts        manifest, get, put, delete
    account/routes.ts       /me, DELETE /account
    store/
      types.ts              ServerStore interface (the seam)
      sqlite-fs.ts          DEFAULT implementation (bun:sqlite + Bun.file)
      memory.ts             for tests
      index.ts              factory switching on STORE_DRIVER
    schema/001_init.sql
  tsconfig.json             paths: "#shared/*" → "../shared/*"
  Dockerfile                FROM oven/bun:1-alpine
  README.md

app/                        client changes
  lib/server/config.ts      API_URL + isServerEnabled
  lib/server/apiClient.ts   fetch wrapper: bearer header, 401 → sign out, JSON/gzip helpers
  lib/server/authStore.ts   module singleton + useSyncExternalStore hook
  lib/server/syncEngine.ts  manifest diff, upload, download, tombstones
  lib/trackHash.ts          content hash (SHA-256 over canonical geometry)
  components/account/
    AccountDrawerItem.tsx   the row inside MoreDrawer's nav card
    SignInDialog.tsx        provider list
    AccountDialog.tsx       identity + sync status + logout + delete
    DeleteAccountBlock.tsx  the in-place second-verification block
  routes/auth-callback.tsx  new route, must be added to app/routes.ts
```

The server is deliberately **not** a bun workspace — `bun install` at the repo root must keep
working for people who only want the static app, and the GitHub Pages workflow must not pull
server dependencies. The two packages have separate `bun.lock` files and share only `shared/`.

### 1.1 Type sharing

`app/types/tracks.ts` moves to `shared/tracks.ts` and the original file becomes a one-line
re-export (`export type * from "#shared/tracks"`), so the ~40 existing `~/types/tracks` import
sites are untouched. New wire DTOs live in `shared/api.ts` and are the single definition of
every request/response body — the server's route handlers and the client's `apiClient` are
typed from the same declarations, so a field rename breaks both typechecks at once.

Wiring:

- Root `tsconfig.json`: add `"#shared/*": ["./shared/*"]` to `paths` and `"shared"` to
  `include`. `vite-tsconfig-paths` (already a dependency) resolves it for the client build.
- `server/tsconfig.json`: same `paths` entry pointing at `../shared/*`. Bun reads tsconfig
  paths natively — no bundler or build step on the server side.

`shared/` must stay free of DOM and Bun globals. Everything in it is either `type`/`interface`
(erased at compile time — always import with `import type`) or a plain numeric/string constant.
`PhotoEntry` deliberately stays client-side: it holds a `File`, which is a DOM type.

### 1.2 Bun-only server

No Node compatibility layer, no transpile step — Bun executes the TypeScript directly.

| Need | Bun built-in used | Not used |
|---|---|---|
| HTTP server | `Bun.serve` via Hono's default `export default { fetch }` | `@hono/node-server` |
| SQLite | `bun:sqlite` | `better-sqlite3` (native module) |
| Blob read/write | `Bun.file(path)`, `Bun.write(path, bytes)` | `node:fs/promises` |
| Gzip | `Bun.gzipSync` / `Bun.gunzipSync` | `node:zlib` |
| Random tokens / hashing | `crypto.getRandomValues`, `crypto.subtle.digest` | — |
| Tests | `bun test` (built in) | vitest / jest |
| Env | `Bun.env` | `dotenv` |

Scripts: `"dev": "bun --hot src/index.ts"`, `"start": "bun src/index.ts"`,
`"typecheck": "tsc --noEmit"`, `"test": "bun test"`. Runtime dependency list is therefore just
`hono`, `arctic`, and `zod` — everything else is the runtime itself.

---

## 2. Storage: one interface, several backings

The seam is `server/src/store/types.ts`:

```ts
export interface ServerStore {
  // identities & users
  findUserByIdentity(provider: string, providerUserId: string): Promise<User | null>
  upsertUserFromIdentity(input: IdentityInput): Promise<User>
  getUser(userId: string): Promise<User | null>
  deleteUser(userId: string): Promise<void>          // cascades identities, sessions, tracks, blobs

  // sessions (token stored hashed)
  createSession(userId: string, tokenHash: string, expiresAt: number): Promise<void>
  findSession(tokenHash: string): Promise<Session | null>
  deleteSession(tokenHash: string): Promise<void>
  deleteSessionsForUser(userId: string): Promise<void>

  // tracks — every method takes userId; there is no cross-user read path
  listManifest(userId: string, sinceCursor: number): Promise<ManifestPage>
  putTrack(userId: string, meta: TrackMeta, blob: Uint8Array): Promise<void>
  getTrackBlob(userId: string, contentHash: string): Promise<Uint8Array | null>
  deleteTrack(userId: string, contentHash: string): Promise<void>  // writes a tombstone
}
```

| Driver | Metadata | Geometry | Bun API | When to pick it |
|---|---|---|---|---|
| **`sqlite-fs` (default, build first)** | `bun:sqlite` file at `DATA_DIR/fogofwalk.db` | gzip files at `DATA_DIR/blobs/<userId>/<hash>.json.gz` | `bun:sqlite`, `Bun.file`/`Bun.write` | Self-host / VPS / Fly volume. One file + one folder to back up. |
| `sqlite-blob` | same `bun:sqlite` file | `BLOB` column | `bun:sqlite` | Single-file deploy, easiest backup; DB grows fast. |
| `postgres-bytea` | Postgres | `bytea` column | `Bun.sql` (built-in, zero deps) | Managed Postgres (Neon, Supabase) without a second service. |
| `postgres-s3` | Postgres | S3 / R2 / MinIO | `Bun.sql` + `Bun.s3` (both built in) | Multi-user scale with large geometry volumes. |
| `memory` | in-process Maps | in-process | — | `bun test` only. |

Chosen at boot by `STORE_DRIVER` env var; `store/index.ts` is the only place that imports the
concrete modules. Only `sqlite-fs` and `memory` are implemented in this increment — the others
are the documented extension points, and all four production drivers are reachable with Bun
built-ins alone (`bun:sqlite`, `Bun.sql`, `Bun.s3`), so none of them adds a dependency.

A Cloudflare D1 + R2 driver is deliberately **not** listed: Workers is a different runtime with
no `bun:sqlite` and no filesystem, so it would need a second entry point and contradict the
Bun-only decision. Adding it later means a `server/src/index.workers.ts`, not a driver swap.

**Schema (`schema/001_init.sql`):**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'allowed' | 'blocked'
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE identities (
  provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, user_id TEXT NOT NULL,
  provider_login TEXT, email TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL);

CREATE TABLE tracks (
  user_id TEXT NOT NULL, content_hash TEXT NOT NULL,
  name TEXT NOT NULL, format TEXT NOT NULL, started_at_ms INTEGER,
  distance_km REAL NOT NULL, point_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL, blob_ref TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, content_hash));
CREATE INDEX tracks_sync ON tracks(user_id, updated_at);

CREATE TABLE track_tombstones (
  user_id TEXT NOT NULL, content_hash TEXT NOT NULL, deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, content_hash));
CREATE INDEX tombstones_sync ON track_tombstones(user_id, deleted_at);
```

`(user_id, content_hash)` as the primary key is what makes dedupe free: re-uploading the same
activity is an idempotent upsert, never a duplicate row.

---

## 3. Auth

**Provider registry** — `server/src/auth/providers/index.ts` exports
`Record<string, OAuthProvider>` where `OAuthProvider` is:

```ts
interface OAuthProvider {
  id: string                                        // "github"
  label: string                                     // "GitHub"
  createAuthUrl(state: string, verifier: string): URL
  exchange(code: string, verifier: string): Promise<{ providerUserId: string;
    login: string; displayName: string; avatarUrl: string | null; email: string | null }>
}
```

Adding Google/Strava later = one new file + one registry line + two env vars. Use **`arctic`**
(MIT) for the OAuth mechanics — it ships GitHub, Google, Apple, Discord, Strava out of the box.

**Flow (bearer token, cross-origin safe):**

1. Client `GET {API}/api/auth/github/start?redirect=<client-origin>` → server stores
   `{state, verifier, redirect}` in a short-lived signed cookie **on its own origin**
   (first-party, so no third-party-cookie problem) and 302s to GitHub.
2. GitHub → `GET {API}/api/auth/github/callback?code&state`. Server validates state, exchanges,
   upserts user + identity, mints a session token, then mints a **single-use 60-second handoff
   code** and 302s to `<client-origin>/auth/callback?code=<handoff>`.
3. Client route `routes/auth-callback.tsx` `POST {API}/api/auth/exchange { code }` →
   `{ token, expiresAt, user }`. Token goes into IDB `prefs` (`"session"`), then
   `navigate("/", { replace: true })`.

The handoff code exists so the long-lived token never appears in a URL, browser history, or the
`Referer` header. Session tokens are 32 random bytes, stored **hashed** (SHA-256) server-side,
90-day expiry, `last_used_at` bumped on use.

**Allowlist (default deny).** Anyone can complete OAuth and gets a `users` row with
`status = 'pending'`. `ALLOWED_LOGINS` env (comma-separated `provider:login`, e.g.
`github:mykhailo`) promotes to `'allowed'` at login time; `status` in the DB is authoritative
afterwards so it can be edited without a redeploy. `GET /api/me` returns
`{ user, capabilities: { sync: boolean } }`. `requireAllowed` middleware guards every
`/api/tracks/*` route and returns `403 { error: "not_allowed" }`. The UI shows the signed-in
name either way — only the sync features are gated.

**Full API surface:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/providers` | — | `[{ id, label }]` — drives the sign-in dialog |
| GET | `/api/auth/:provider/start` | — | 302 to provider |
| GET | `/api/auth/:provider/callback` | — | 302 back to client with handoff code |
| POST | `/api/auth/exchange` | — | handoff code → bearer token |
| POST | `/api/auth/logout` | session | revoke this session |
| GET | `/api/me` | session | user + capabilities |
| DELETE | `/api/account` | session | erase user, identities, sessions, tracks, blobs |
| GET | `/api/tracks/manifest?since=<cursor>` | allowed | metadata + tombstones page |
| GET | `/api/tracks/:contentHash` | allowed | gzipped track JSON |
| PUT | `/api/tracks/:contentHash` | allowed | upload (idempotent) |
| DELETE | `/api/tracks/:contentHash` | allowed | delete + tombstone |

CORS: `hono/cors` with an explicit `ALLOWED_ORIGINS` list (no `*`), `Authorization` allowed,
credentials off. Per-user rate limit on `PUT` and a `MAX_TRACK_BYTES` cap (default 8 MB).

---

## 4. Sync

### Content hash (`app/lib/trackHash.ts`)

Deterministic across devices, derived only from geometry so a renamed file is not a new track:

```ts
// canonical: `${format}|${startedAtMs ?? ""}|${coords.length}|` +
//            coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";")
export async function computeContentHash(track: ParsedTrack): Promise<string>  // sha256 hex
```

Uses `crypto.subtle.digest` (already available — secure context, nothing uses it yet).
Deliberately excludes `name` and `stats` (`stats.uniqueDistanceKm` is library-relative and
mutated in place by `populateUniqueDistances`, so it can never be part of an identity).

Known limitation, documented rather than solved: the *same activity* exported as both `.gpx` and
`.fit` hashes differently and will sync as two tracks. Cross-format dedupe would need fuzzy
matching on `startedAtMs` + distance.

`ParsedTrack` (now in `shared/tracks.ts`) gains `contentHash?: string` — the one field both
sides read, which is exactly why it belongs in the shared module. It is populated at parse time
in `app/lib/parsers/gpx.ts` and `app/lib/parsers/fit.ts`, and **backfilled lazily** for legacy
tracks by the sync engine (compute → `saveTracks` write-back). This follows the existing
read-time-migration precedent in `loadTracks()` for `startedAtMs`/`uniqueDistanceKm`.
No `DB_VERSION` bump is needed for that field (optional + structured clone), but the `prefs`
store gains two keys, reusing the existing generic KV: `"session"` and `"syncState"`.

### Protocol

```
1. GET /api/tracks/manifest?since=<lastCursor>
     → { tracks: [{ contentHash, name, startedAtMs, sizeBytes, updatedAt }],
         deletions: [{ contentHash, deletedAt }], cursor, hasMore }
2. toUpload   = localHashes − serverHashes − serverDeletions
   toDownload = serverHashes − localHashes
   toDelete   = serverDeletions ∩ localHashes
3. PUT /api/tracks/:hash   for each toUpload   (gzip body, 409 treated as success)
   GET /api/tracks/:hash   for each toDownload
   local deleteTrack(id)   for each toDelete
4. persist { lastCursor, lastSyncAt } to prefs["syncState"]
```

Concurrency capped at 3 in-flight requests; failures are per-track and retried on the next run,
so a partial sync is always safe to resume.

**Ingest path must be shared.** Downloaded tracks need exactly what `add-files` does:
merge into `mapStore.tracks` via `sortTracks`, `populateUniqueDistances`, `postToFogWorker`
(**join** the current run — do *not* call `startFogRun()`), `saveTracks`, `clearFogCache`.
Extract that block out of `clientAction`'s `add-files` branch in `app/routes/home.tsx:152+`
into `mapStore.ingestTracks(tracks)` and call it from both places. Downloaded tracks get a
fresh local `crypto.randomUUID()` id — the server key is the content hash, local ids stay local.

**Upload payload** strips `id` and zeroes `stats.uniqueDistanceKm`; the receiving device
recomputes it. Body is gzipped with `CompressionStream("gzip")` and sent with
`Content-Encoding: gzip`.

**Sync triggers:** after `clientLoader` finishes restoring (fire-and-forget, never blocks the
map), on successful sign-in, and after `add-files` / `delete-track` complete. When signed in and
allowed, `delete-track` also issues `DELETE /api/tracks/:hash` so the tombstone propagates.

**Service-worker caveat:** `app/sw.ts` currently applies `StaleWhileRevalidate` to all `*.json`
responses. Sync requests are cross-origin to `VITE_API_URL`, but add an explicit `NetworkOnly`
rule for the API origin so a future same-origin deployment cannot serve stale manifests.

---

## 5. Client UI

### Auth state

`app/lib/server/authStore.ts` — a mutable module singleton mirroring the existing `mapStore.ts`
idiom (the codebase uses zero React Contexts), exposed to components via
`useSyncExternalStore`. This avoids extending the already-20-prop chain
`home.tsx → ControlPanel → MoreDrawer`.

```ts
type AuthState =
  | { status: "disabled" }                                   // VITE_API_URL unset
  | { status: "loading" } | { status: "signedOut" }
  | { status: "signedIn"; user: ServerUser; canSync: boolean }
```

### `MoreDrawer` — account row

Prepend one `Item` to the existing **section 3 (Navigation)** card
(`app/components/MoreDrawer.tsx:225`), followed by the same
`<div className="ml-10 border-t border-foreground/10" />` separator the nav rows already use.
Renders nothing at all when `status === "disabled"`, so the GitHub Pages build is byte-for-byte
unchanged in behaviour.

- **Signed out** — `SignInIcon` / `ItemTitle` "Sign in" / `CaretRightIcon` → opens `SignInDialog`.
- **Signed in** — avatar (plain `<img>` in `ItemMedia variant="icon"`, rounded, with an
  initials fallback — no `avatar` primitive is installed and one is not worth adding),
  `ItemTitle` = display name, `ItemDescription` = sync status
  (`"Synced 2 min ago"` / `"Syncing 3 of 12…"` / `"Sync paused"` / `"Not enabled for sync"`)
  → opens `AccountDialog`.

Both follow the drawer's established escape hatch, which also sidesteps the documented
vaul/Base-UI focus trap: `close(); setTimeout(() => setIsAccountOpen(true), 250)`, with the
dialogs rendered as **siblings of `<Drawer>`** inside `MoreDrawer`'s fragment — exactly how
`ClearAllDialog` is already wired.

### `SignInDialog`

Controlled `Dialog` (`open` / `onOpenChange`), lists providers from `/api/auth/providers` as
buttons; clicking sets `window.location.href = ${API}/api/auth/${id}/start?redirect=${origin}`.
Copy the async/error idiom from `ShareDialog.tsx` (`isSubmitting`, inline
`<p className="text-xs text-destructive">`, auto-cleared after 4 s).

### `AccountDialog`

Sections, top to bottom:

1. Identity — avatar, display name, `signed in with GitHub`.
2. Sync — last-sync line + a "Sync now" button. Replaced by a muted
   "Your account isn't enabled for sync yet." notice when `canSync === false`.
3. `DialogFooter` — `variant="outline"` **Log out**, `variant="destructive"` **Delete account**.

### `DeleteAccountBlock` — in-place second verification

Clicking **Delete account** does *not* open a nested dialog (nested Base UI dialogs inside a
vaul drawer are the exact fragile combination CLAUDE.md documents three workarounds for).
Instead `isDeleteConfirmOpen` swaps the footer for an inline block rendered in the dialog body:

```
┌ ring-1 ring-destructive/30, p-3, space-y-2 ─────────────────┐
│ Delete your account?                        (text-sm)        │
│ Your account, sign-in and all synced tracks will be          │
│ permanently deleted. Tracks already on this device stay.     │
│ This cannot be undone.                      (text-xs muted)  │
│                        [ Cancel ]  [ Delete permanently ]    │
└──────────────────────────────────────────────────────────────┘
```

Confirm → `DELETE /api/account` → clear the session from IDB → `authStore` to `signedOut` →
close dialog. Local tracks are untouched by design; the block says so explicitly. Errors render
inline in the block, the dialog stays open. Booleans use the mandated `is` prefix; icons use the
mandated `*Icon` Phosphor suffix.

### New route

`app/routes/auth-callback.tsx` — must be added to `app/routes.ts`
(`route("/auth/callback", "routes/auth-callback.tsx")`), which is explicit, not file-discovered.
Renders a centred spinner, exchanges the handoff code, then `navigate("/", { replace: true })`.
The GitHub Pages `404.html` fallback already handles the deep link.

---

## 6. Licensing (org policy)

The Bun-only choice shrinks the dependency surface to three packages, all permissive:
**Hono** MIT, **arctic** MIT, **zod** MIT. Bun itself is MIT and SQLite is public domain; the
`bun:sqlite`, `Bun.sql` and `Bun.s3` drivers ship with the runtime, so the Postgres and S3
options add **no** third-party dependency at all. No GPL/LGPL/AGPL code enters the tree.

Explicit warning for whoever extends this: several popular self-hosted sync/BaaS backends ship
**AGPL** server components. Do not adopt one as a storage driver — implement the `ServerStore`
interface against a permissively licensed database instead.

---

## 7. Phases

0. **Shared types** — create `shared/`, move `app/types/tracks.ts` into it behind a re-export,
   add the `#shared/*` path to the root tsconfig, add `shared/api.ts` + `shared/constants.ts`.
   `bun run typecheck` must stay green with zero changes to existing import sites.
1. **Server skeleton** — `server/` Bun package, env parsing, Hono + CORS, `ServerStore`
   interface, `sqlite-fs` + `memory` drivers, schema, Dockerfile, README.
2. **Auth** — provider registry + GitHub, start/callback/exchange/logout, session middleware,
   allowlist, `/api/me`, `DELETE /api/account`.
3. **Client auth** — config, `apiClient`, `authStore`, `/auth/callback` route, drawer row,
   `SignInDialog`, `AccountDialog`, `DeleteAccountBlock`. *Sync still absent — the account
   dialog shows "Sync coming soon".* Ship-able on its own.
4. **Sync** — `trackHash.ts`, hashes in both parsers + lazy backfill, `mapStore.ingestTracks`
   extraction, server track routes + tombstones, `syncEngine.ts`, sync triggers.
5. **Polish** — sync status in the drawer row, retry/backoff, quota + error surfaces,
   `docs/architecture.md` update, `CLAUDE.md` section on the server and sync invariants.

---

## 8. Verification

**Server-less regression (the critical one).** `bun run build` with `VITE_API_URL` unset →
`bun run typecheck` clean, app loads, imports a GPX, clears fog, `MoreDrawer` shows exactly
today's five sections, and the Network tab shows **no request to any API origin**. The GitHub
Pages workflow is not modified.

Note the account code is still *present* in the bundle, just inert: `MoreDrawer` imports
`AccountDrawerItem` unconditionally, so the modules are reachable and only the runtime flag
(`isServerEnabled`, folded to false) stops them. The guarantee being verified is behavioural —
no requests, no UI, no stored state — not bundle exclusion. Stripping the bytes as well would
mean a conditional dynamic import, which is not worth the complexity for a few KB.

**Auth.** Register a GitHub OAuth app with callback
`http://localhost:8787/api/auth/github/callback`. `cd server && bun run dev`; client
`VITE_API_URL=http://localhost:8787 bun run dev`.

- Sign in as a login **not** in `ALLOWED_LOGINS` → name appears in the drawer, account dialog
  shows the "not enabled" notice, `GET /api/tracks/manifest` returns 403.
- Add the login to `ALLOWED_LOGINS`, restart, sign in again → sync section appears.
- Log out → drawer returns to "Sign in"; the old bearer token now 401s.

**Sync + dedupe.** Two browser profiles signed in as the same user:

- Import `sample-run.gpx` in A → appears in B after its next sync, fog recomputes.
- Import the *same file again* in A → `PUT` returns 409/idempotent, `tracks` row count
  unchanged (`sqlite3 data/fogofwalk.db "SELECT count(*) FROM tracks"`), B gains nothing.
- Import the same file in B *before* it syncs → identical `content_hash`, still one row.
- Delete the track in A → tombstone row exists, B removes it on next sync.
- Kill the server mid-upload → client retries on next trigger, no duplicate rows.

**Isolation.** Sign in as a second GitHub account, capture its bearer token, and call
`GET /api/tracks/:hash` for a hash belonging to the first user → must be 404, never 200.
Confirm blob paths are namespaced by `userId`.

**Account deletion.** Delete account → in-place block requires the second click;
`users` / `identities` / `sessions` / `tracks` / `track_tombstones` rows for that user are gone,
`DATA_DIR/blobs/<userId>/` is removed, the token 401s, and the device's local tracks and fog are
still on screen after a reload.

**Type sharing.** Rename a field in `shared/api.ts` (e.g. `ManifestPage.cursor`) and confirm
that *both* `bun run typecheck` at the root and `bun run typecheck` in `server/` fail — that is
the proof the two sides are typed from one declaration rather than two copies that drifted.
Also confirm no `shared/` type survives into the client bundle
(`grep -r "ManifestPage" build/assets` → nothing; types are erased, constants are not).

**Bun-only.** `server/` has no `node_modules` entry for `better-sqlite3`, `pg`, `dotenv` or
`@hono/node-server`; `bun src/index.ts` boots with no build step; `bun test` passes against the
`memory` driver; `docker build server/` on `oven/bun:1-alpine` runs the same command.

**Every step:** `bun run typecheck` in both packages, `bun run format`.

---

## 9. Explicitly out of scope

Photo sync (blobs are large and photos carry no `trackId` — associations are recomputed at
render time), social features (following, feeds, public profiles), conflict resolution beyond
last-write-wins on immutable content-addressed tracks, and cross-format dedupe.
