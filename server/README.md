# Fog of Walk — sync server

Optional companion to the Fog of Walk SPA. Without it the app is exactly what
it has always been: a fully client-side, server-less map. With it, and with
`VITE_API_URL` set at build time, the same static bundle gains GitHub sign-in
and background track sync.

It is a standalone **Bun** package — not a workspace of the client. `bun
install` at the repository root never pulls these dependencies, and the GitHub
Pages workflow is untouched. The only thing the two sides share is `../shared`.
`shared/tracks.ts` and `shared/api.ts` are type-only and vanish at compile time;
`shared/constants.ts` is not — the client imports `HASH_COORD_PRECISION`,
`MAX_TRACK_BYTES` and `SYNC_CONCURRENCY` as runtime values, so those literals do
reach the browser bundle. Keep it free of anything heavier than a constant.

Runtime dependencies are `hono`, `arctic` and `zod` (all MIT). Everything else
— HTTP, SQLite, gzip, hashing, tests, env loading — is the Bun runtime itself.

## Quick start

```bash
cd server
bun install
cp .env.example .env         # then edit it — see the table below
bun run dev                  # http://localhost:8787, hot reload
curl localhost:8787/health   # {"ok":true}
```

| Script | What it does |
| --- | --- |
| `bun run dev` | `bun --hot src/index.ts` |
| `bun run start` | `bun src/index.ts` |
| `bun run typecheck` | `tsc --noEmit` (run after every change) |
| `bun run test` | `bun test` — mostly against the in-memory driver; `tests/sqliteFs.test.ts` exercises the real `sqlite-fs` one |

Run the client against it with `VITE_API_URL=http://localhost:8787 bun run dev`
from the repository root.

## Environment

Bun loads `server/.env` automatically. Every variable is validated at boot;
a missing or malformed one aborts startup with a message naming it.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `8787` | Port `Bun.serve` listens on. |
| `HOST` | no | `0.0.0.0` | Interface to bind. Right for a container; behind a reverse proxy use `127.0.0.1` so the port is unreachable from the network. |
| `DATA_DIR` | no | `./data` | SQLite file + blob tree (`sqlite-fs`). |
| `STORE_DRIVER` | no | `sqlite-fs` | `sqlite-fs` or `memory`. |
| `ALLOWED_ORIGINS` | **yes** | — | Comma-separated exact client origins. Drives CORS *and* the OAuth redirect allowlist. Never `*`. |
| `ALLOWED_LOGINS` | no | empty | Comma-separated `provider:login`. Empty means **nobody** can sync. |
| `SESSION_SECRET` | **yes** | — | ≥ 32 chars. Signs the OAuth state cookie. |
| `PUBLIC_URL` | **yes** | — | This server's externally reachable base URL. The OAuth callback URI is derived from it. |
| `GITHUB_CLIENT_ID` | pair | — | Omit both to leave GitHub sign-in off. |
| `GITHUB_CLIENT_SECRET` | pair | — | Must be set together with the id. |

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | — | Liveness. |
| GET | `/api/auth/providers` | — | `{ providers: [{ id, label }] }` — drives the sign-in dialog. |
| GET | `/api/auth/:provider/start?redirect=<origin>` | — | 302 to the provider. |
| GET | `/api/auth/:provider/callback` | — | 302 back to `<origin>/auth/callback?code=<handoff>`. |
| POST | `/api/auth/exchange` | — | Handoff code → bearer token. |
| POST | `/api/auth/logout` | session | Revokes this session. |
| GET | `/api/me` | session | User + capabilities. |
| GET | `/api/account/export` | session | Full JSON export of the requesting user's account data. |
| DELETE | `/api/account` | session | Erases the account server-side. |
| GET | `/api/tracks/manifest?since=<cursor>` | allowed | Metadata + tombstones page. |
| PUT | `/api/tracks/:contentHash` | allowed | Gzipped upload, idempotent. |
| GET | `/api/tracks/:contentHash` | allowed | The gzipped track JSON. |
| DELETE | `/api/tracks` | allowed | Purge every track for this user. **No tombstones** — other devices keep their copies. Backs "Remove all". |
| DELETE | `/api/tracks/:contentHash` | allowed | Delete + tombstone. Returns the tombstone's `deletedAt`. |

Non-2xx bodies are always `{ error, message? }` with `error` drawn from
`ApiErrorCode` in `shared/api.ts`.

### Sign-in flow

`start` stores `{state, verifier, redirect}` in a signed, HttpOnly,
first-party cookie **on the API origin** — no third-party cookie is involved,
so nothing here depends on a browser policy that is on its way out. The
callback validates the state, exchanges the code, upserts the user, and hands
the client a **single-use 60-second code** rather than the session token: the
long-lived token never appears in a URL, in history, or in a `Referer` header.
`POST /api/auth/exchange` trades that code for the token, which the client then
sends as `Authorization: Bearer …`.

Session tokens are 32 random bytes and are stored **hashed** (SHA-256), so a
database dump contains nothing replayable. They live 90 days
(`SESSION_TTL_MS`) and their `last_used_at` is bumped on every request.

Handoff codes live in process memory. A restart therefore drops the sign-ins
that are mid-flight — those users see the callback fail and sign in again.

### Allowlist (default deny)

Anyone can complete OAuth; everyone lands as `status = 'pending'` and gets a
`403 { error: "not_allowed" }` from every `/api/tracks/*` route. `/api/me`
still works, so the UI can greet them by name and explain the situation.

`ALLOWED_LOGINS` can only **promote**, and only from `pending`:

```
ALLOWED_LOGINS=github:alice,github:bob
```

To allowlist a user:

1. Add `provider:login` to `ALLOWED_LOGINS` and restart, then have them sign in
   again — the promotion happens at sign-in.
2. Or edit the database directly, which takes effect immediately and needs no
   redeploy — the database is authoritative. Match on `identities.provider_login`,
   the same key the allowlist uses; `users.display_name` is a free-text profile
   name and is often not the login at all:
   ```bash
   sqlite3 data/fogofwalk.db \
     "UPDATE users SET status='allowed' WHERE id = (
        SELECT user_id FROM identities
        WHERE provider='github' AND provider_login='alice');"
   ```

Blocking works the same way (`status='blocked'`), and the env var can never
undo it: a blocked account is never promoted, and an allowed account is never
demoted by removing it from the list.

## Registering the GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** → *New OAuth App*.
2. **Homepage URL**: your client origin, e.g. `http://localhost:5173`.
3. **Authorization callback URL**: `PUBLIC_URL/api/auth/github/callback` —
   for local development exactly `http://localhost:8787/api/auth/github/callback`.
4. Generate a client secret; put the pair in `GITHUB_CLIENT_ID` /
   `GITHUB_CLIENT_SECRET`.
5. Restart. `GET /api/auth/providers` now lists GitHub; with the pair absent it
   returns an empty list and the sign-in dialog has nothing to show.

The requested scopes are `read:user` and `user:email`. The primary verified
email is best-effort — an account without one still signs in.

## Adding another OAuth provider

`arctic` already ships Google, Apple, Discord, Strava and others.

1. `src/auth/providers/<name>.ts` — export a factory returning an
   `OAuthProvider` (`src/auth/providers/types.ts`): `id`, `label`,
   `createAuthUrl(state, verifier)`, `exchange(code, verifier)` → profile.
   `verifier` is the PKCE code verifier; providers that support PKCE should use
   it, GitHub ignores it.
2. Add the two credential variables to `src/env.ts` (optional as a pair, like
   GitHub's) and to `.env.example`.
3. One line in `src/auth/providers/index.ts`, guarded on the credentials being
   present.

Routes, middleware and the client dialog need no change: `/start` and
`/callback` are generic over `:provider`, and the dialog renders whatever
`/api/auth/providers` lists.

## Storage drivers

`src/store/types.ts` is the seam. Every track method takes `userId` first and
there is no method that can read a track without naming its owner, so
cross-user isolation is a property of the interface rather than of its callers.

| Driver | Metadata | Geometry | Status |
| --- | --- | --- | --- |
| `sqlite-fs` | `bun:sqlite` at `DATA_DIR/fogofwalk.db` | `DATA_DIR/blobs/<userId>/<hash>.json.gz` | **default** |
| `memory` | Maps | Maps | tests only |
| `sqlite-blob` | same DB | `BLOB` column | extension point |
| `postgres-bytea` | Postgres via `Bun.sql` | `bytea` | extension point |
| `postgres-s3` | Postgres via `Bun.sql` | `Bun.s3` | extension point |

To add one: implement `ServerStore` in `src/store/<driver>.ts`, add a `case` to
`src/store/index.ts` (the only module allowed to import a concrete driver), and
document its variables here. All four production options are reachable with Bun
built-ins, so none of them adds a dependency.

> **Licensing:** this is commercial software. Several popular self-hosted sync
> backends ship **AGPL** server components — do not adopt one as a driver.
> Implement `ServerStore` against a permissively licensed database instead.

Backing up `sqlite-fs` is one file plus one folder: `DATA_DIR/fogofwalk.db*`
(WAL is on, so copy the `-wal`/`-shm` siblings too, or use
`sqlite3 … ".backup"`) and `DATA_DIR/blobs/`.

## Sync notes

- The **content hash is the identity** of a track, and the server recomputes it
  from the uploaded geometry. A `PUT` whose URL hash disagrees with its payload
  is a `400` — that is what stops one device poisoning another's data.
- Account export remains available to pending users because it is a personal-data
  access operation, not a sync operation. It is limited to one accepted
  request per user per 15 minutes and two in-flight exports per process.
  Rejections are `429` responses with both `Retry-After` and `retryAfterMs`.
  The export is intentionally not silently truncated; large accounts still
  require a streaming or asynchronous export design before their memory cost
  can be reduced.
- Uploads are **idempotent**: `(user_id, content_hash)` is the primary key, and
  re-uploading identical geometry keeps the original `updated_at` so retries do
  not churn every other device's manifest.
- Deletes write a **tombstone** so other devices learn about them, and are
  idempotent — deleting an unknown hash still records one.
- The manifest cursor is a timestamp used as an **inclusive** lower bound, and
  a page never splits a millisecond. The reasoning, including the two ways this
  goes wrong, is in the header comment of `src/store/manifestPaging.ts`.
- `MAX_TRACK_BYTES` (8 MB, from `shared/constants.ts`) is enforced *while*
  reading the body, and decompression is capped too, so neither a huge upload
  nor a zip bomb gets buffered.
- The `PUT` rate limit is per-user and **in-process**: it protects one server
  from a runaway client, not from a distributed attacker. Running more than one
  instance would need a shared limiter. The window and the cap live in
  `shared/constants.ts` because the client paces itself against the same numbers
  — a 429 is the fallback, not the mechanism. When one is returned it carries
  `retryAfterMs` in the body *and* a standard `Retry-After` header; the body is
  what the browser client reads, since a cross-origin response header is
  invisible to JS unless CORS exposes it.

## Deployment

Production runs on a Debian VPS as a plain systemd unit — Bun executing the
TypeScript directly, Caddy in front for TLS. `.github/workflows/deploy-server.yml`
does it on every push to `master` that touches `server/**` or `shared/**`, and on
manual dispatch. Everything the VPS needs is in [`deploy/`](deploy/).

The in-process export controls are only one layer. Keep `HOST=127.0.0.1` when
Caddy is present, apply per-IP throttling and connection/request timeouts at
the edge, and cap upstream concurrency there as well. Do not trust arbitrary
`X-Forwarded-For` values when deriving an IP limit; only use headers supplied by
a configured trusted proxy. The per-user limiter must move to a shared store if
the service is ever run on multiple application instances.

### Layout on the box

```
/srv/fogofwalk/
  releases/<sha>/{server,shared}   # one directory per deploy, rsync'd from CI
  current -> releases/<sha>        # the symlink the unit's WorkingDirectory follows
  data/                            # DATA_DIR — survives every deploy and rollback
  cache/                           # HOME for the service (the unit blocks the real one)
  server.env                       # rendered from GitHub secrets each deploy, 0600
```

Two accounts: `fogofwalk` runs the process (no shell, can write only `data/` and
`cache/`), `deploy` receives the SSH connection and may restart exactly one unit
via a narrow sudoers rule. Port 8787 is never opened — `HOST=127.0.0.1` means
Caddy is the only way in.

### First-time setup

1. Point `api.<your-domain>` at the VPS with an `A` record, and leave ports 80
   and 443 open. Caddy needs 80 for the ACME challenge even though nothing is
   served there.
2. Register a **production** GitHub OAuth app — keep the dev one on localhost.
   Homepage is the client origin; the authorization callback URL must be exactly
   `${PUBLIC_URL}/api/auth/github/callback`, since that is what `redirectUriFor()`
   builds.
3. Generate a CI keypair: `ssh-keygen -t ed25519 -C github-actions -f deploy_key`,
   no passphrase.
4. Provision the box:
   ```bash
   scp -r server/deploy root@<vps>:/tmp/fow-deploy
   scp deploy_key.pub root@<vps>:/tmp/fow-deploy/
   ssh root@<vps> 'DEPLOY_SSH_KEY="$(cat /tmp/fow-deploy/deploy_key.pub)" bash /tmp/fow-deploy/provision.sh'
   ```
   Copy the `.pub` file across rather than interpolating it into the command:
   inside `'...'` the `$(cat)` runs on the VPS, and inside `"..."` your local
   shell would expand `$DEPLOY_SSH_KEY` first. Either mistake leaves the deploy
   user with no authorized key, and the workflow fails with
   `Permission denied (publickey)`. The script prints the authorised
   fingerprints at the end — check yours is there.
   Idempotent — re-run it after editing `fogofwalk.service` or the `Caddyfile`.
   It installs Bun (pinned by `BUN_VERSION`; keep it in step with the
   `bun-version` in the workflow), Caddy, both users, the layout, the unit, the
   sudoers rule and the firewall. It does not start the service: there is no
   release yet, so the unit will show as failed until the first deploy.
5. Add the repo secrets and variables:

   | Kind | Name | Example |
   | --- | --- | --- |
   | secret | `VPS_SSH_KEY` | private half of the CI keypair |
   | secret | `VPS_KNOWN_HOSTS` | output of `ssh-keyscan <the exact value of VPS_HOST>` |
   | secret | `SESSION_SECRET` | ≥ 32 chars, **not** the one in your local `.env` |
   | secret | `OAUTH_GITHUB_CLIENT_SECRET` | from the production OAuth app |
   | variable | `VPS_HOST` | VPS IP or hostname |
   | variable | `VPS_USER` | `deploy` |
   | variable | `API_PUBLIC_URL` | `https://api.fog-of-walk.mykhailo.net` |
   | variable | `ALLOWED_ORIGINS` | `https://fog-of-walk.mykhailo.net` |
   | variable | `ALLOWED_LOGINS` | `github:your-login` |
   | variable | `OAUTH_GITHUB_CLIENT_ID` | from the production OAuth app |
   | variable | `VITE_API_URL` | same as `API_PUBLIC_URL` — read by the Pages build |

   The `OAUTH_` prefix is not decoration: GitHub refuses secret and variable
   names beginning with `GITHUB_`. The workflow maps them back to
   `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` when it renders `server.env`.

   `VPS_KNOWN_HOSTS` has to cover **the exact name `VPS_HOST` holds** — ssh
   matches `known_hosts` against the name it is given, so a key scanned from the
   IP does not cover the hostname. The workflow checks this before its first SSH
   and tells you what to re-scan. `ssh-keyscan` is trust-on-first-use, so verify
   the fingerprint against the box itself:
   ```bash
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub          # on the VPS
   ssh-keygen -lf <(ssh-keyscan -t ed25519 "$VPS_HOST")      # locally, must match
   ```
6. Run the workflow from the Actions tab (`workflow_dispatch`) rather than
   waiting for a push, so a configuration mistake is isolated from a code change.

### What a deploy does

Typecheck and tests first — a red suite never reaches the VPS. Then the env file
is rendered and piped over stdin (so no secret appears in the remote command
line), `server/` and `shared/` are rsync'd into a new release directory, and
[`deploy/release.sh`](deploy/release.sh) installs dependencies, swaps the
`current` symlink, restarts the unit and polls `/health`. If it does not come up
the previous release is put back and the job fails. Old releases are pruned to
the newest three.

`env.ts` validates with Zod at import time, so a malformed `server.env` kills
the process at boot — which the health check catches and rolls back.

### Operating it

```bash
journalctl -u fogofwalk -f                  # logs
sudo systemctl restart fogofwalk            # restart
ls -l /srv/fogofwalk/current                # which release is live
ln -sfn /srv/fogofwalk/releases/<sha> /srv/fogofwalk/current \
  && sudo systemctl restart fogofwalk       # manual rollback
```

State is `/srv/fogofwalk/data`: `fogofwalk.db` (plus `-wal`/`-shm`) and
`blobs/`. To back it up, use `sqlite3 fogofwalk.db ".backup out.db"` rather than
copying the file under WAL, and tar `blobs/` alongside it.

Note the `PUT` rate limiter and the 60-second OAuth handoff codes are
in-process, so this is a **single-instance** deployment by design. Running two
copies against one data directory is not supported.

### Docker, as an alternative

```bash
docker build -f server/Dockerfile -t fogofwalk-server .   # from the repo root
docker run -p 8787:8787 -v fogofwalk-data:/data --env-file server/.env \
  fogofwalk-server
```

The build context is the **repository root**, not `server/`, because the image
needs `shared/`. The container runs as the non-root `bun` user and keeps its
state in the `/data` volume (`DATA_DIR=/data`). There is no build step: Bun
executes the TypeScript directly.

Behind any reverse proxy, make sure `PUBLIC_URL` matches the public https URL —
the OAuth callback and the state cookie's `Secure` flag are both derived from
it.
