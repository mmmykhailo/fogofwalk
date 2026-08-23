# Implementation plan: UI-managed server access whitelist

## Goal and behavior

Replace routine access-list edits with a database-backed access-request workflow:

- A signed-in user without sync access can submit one access request from the
  account dialog and see whether it is pending, approved, or rejected.
- An administrator can open `/admin`, review requests, approve or reject them,
  and review/change the access state of existing users.
- A newly submitted request triggers a Telegram Bot API notification to the
  private chat/channel configured in the admin UI.
- `/admin` and every `/api/admin/*` endpoint behave as not found unless a
  current server session belongs to an administrator.

The admin identity remains deployment configuration. Introduce
`ADMIN_LOGINS=github:mmmykhailo` as a comma-separated, case-insensitive list of
`provider:login` identities. The database must never be able to grant admin
rights. A matching admin identity is also promoted from `pending` to `allowed`
at sign-in so the bootstrap administrator does not need a second whitelist
mechanism.

Both the Telegram bot token and destination `chat_id` are configured in the
admin UI. The token is a write-only secret: an admin may set, replace, test, or
remove it, but the server never sends its value back to the browser. Treat the
chat ID as a trimmed string, not a JavaScript number, because Telegram
channel/supergroup IDs are negative and may exceed safe integer handling.

## 1. Extend environment configuration

Update `server/src/env.ts`, `server/.env.example`, `server/README.md`, the test
setup, and `.github/workflows/deploy-server.yml`:

- Add required, non-empty `ADMIN_LOGINS`, normalized exactly as the current
  allowlist is normalized. Production starts with `github:mmmykhailo` while
  examples/tests use a fixture identity.
- Remove the legacy environment whitelist; only an env-configured admin may be
  automatically promoted.
- Validate that every admin entry has the `provider:login` shape. Telegram
  configuration is deliberately absent from env configuration and deployment
  secrets; an unset UI configuration disables notifications without
  preventing sign-in, access requests, or admin decisions.

Existing `allowed` rows remain authoritative after deployment. Back up the
database before deploying the schema update.

## 2. Add persisted requests and admin settings

Extend `server/src/schema/001_init.sql`, the idempotent migration path in
`server/src/store/sqlite-fs.ts`, the memory driver, and `ServerStore` with two
small data models.

`access_requests`:

| Column | Purpose |
| --- | --- |
| `id` | Random UUID used by admin mutation routes. |
| `user_id` | Unique applicant; references the existing user logically. |
| `status` | `pending`, `approved`, or `rejected`. |
| `requested_at` | First submission time. |
| `decided_at` | Null until an admin decision. |
| `decided_by` | Null or the admin user's ID for auditability. |
| `notification_status` | `not_configured`, `sent`, or `failed`. |
| `notification_attempted_at` | Null until Telegram was attempted. |

Keep one request row per user. `POST /api/access-request` is idempotent: it
creates the initial row, but repeated clicks/retries return the existing row
and do not send duplicate Telegram messages. A rejected request is terminal
from the applicant's UI; an administrator may later approve it. This avoids a
self-service notification spam loop.

`server_settings`:

| Column | Purpose |
| --- | --- |
| `key` | Primary key; initially `telegram_chat_id` and `telegram_bot_token`. |
| `value` | Plain chat ID or a versioned encrypted token envelope. |
| `updated_at` | Audit/diagnostic timestamp. |
| `updated_by` | Admin user ID. |

Encrypt the bot token before storing it. Derive a dedicated AES-GCM key from
the existing `SESSION_SECRET` via HKDF in Web Crypto with fixed,
application-specific salt/info labels, generate a fresh random IV on every
write, and store a versioned base64 envelope containing only ciphertext and
IV. Do not reuse the OAuth/session signing bytes directly as an encryption
key. This adds no dependency and avoids a reusable Telegram credential sitting
in plaintext in a database backup. Document that rotating `SESSION_SECRET`
invalidates the saved bot token; the admin page must then report it as
unavailable and allow the administrator to enter it again. Never log the
ciphertext, plaintext, or Telegram request URL (the URL contains the token).

Add focused store methods rather than exposing generic SQL-shaped access:
get/create the current user's request, list users with their primary identity
and request state, decide a request atomically, set a user's access status,
and get/set the Telegram chat ID and encrypted bot token. Approval must update
the request to `approved` and the user to `allowed` in one SQLite transaction;
rejection must set the request to `rejected` and the user to `blocked` in the
same transaction. Re-enabling a rejected/blocked user is an explicit admin
action. Deleting an account must also delete its request row.

## 3. Build masked admin authorization

Add an admin identity helper that checks all identities returned by
`findIdentitiesForUser` against `env.ADMIN_LOGINS`. Use stable provider login,
not `users.handle` or display name. The helper is the only source of admin
truth.

Create a dedicated `createRequireAdmin(store)` middleware. It verifies the
bearer session and the env identity, but returns the same generic
`404 { error: "not_found" }` for all of these cases:

- no bearer token;
- malformed, expired, or revoked session;
- deleted user;
- valid non-admin user.

Do not put the normal `requireSession` middleware in front of it, because its
401 would reveal that the route exists. Mount all admin routes beneath this
middleware and add route-level tests proving the responses are
indistinguishable. The 404 is concealment only; every read and mutation still
requires the server-side admin check.

Extend `UserCapabilities` with `admin: boolean` so the authenticated client may
show an Admin link to the real admin. Computing capabilities becomes async
because it consults identities. Cached capabilities are only a presentation
hint: `/api/admin/*` always revalidates the live session and env identity.
Carry that value into `AuthState` as `isAdmin` alongside the existing
`canSync`, and persist the expanded capabilities object with the session.

## 4. Add access-request APIs for signed-in users

Add routes available behind `requireSession`, but not `requireAllowed`:

| Method and path | Behavior |
| --- | --- |
| `GET /api/access-request` | Returns `null` or the current user's request state. |
| `POST /api/access-request` | Creates the idempotent request, attempts one notification, and returns the saved state. |

Reject request creation when the user is already `allowed` or `blocked`; an
allowed user needs no request and a rejected/blocked user must contact the
administrator rather than generate repeated notifications. Use a small
per-user rate limit as defense in depth even though the unique row makes the
operation idempotent.

Define the request/response types in `shared/api.ts`. Do not expose applicant
email, internal IDs, notification errors, Telegram configuration, or admin
audit fields to the applicant endpoint.

When an admin decision changes a currently signed-in user's status, their next
`/api/me` refresh must return the new status/capabilities. The account dialog
should provide a refresh action after submission and may poll only while open
and pending (for example every 30 seconds). Do not start a permanent global
poller. Once approval is observed, update the persisted client session and
trigger the existing manual sync path so a reload is not required.

## 5. Send Telegram notifications with the native HTTP API

Create a small server module that calls Telegram directly with the runtime's
global `fetch`; add no Telegram or HTTP client dependency.

Send:

```text
POST https://api.telegram.org/bot<TOKEN>/sendMessage
Content-Type: application/json

{"chat_id":"<configured id>","text":"<plain text>"}
```

Use plain text with no `parse_mode`, so provider-controlled names and logins
cannot inject Telegram markup. Include display name, `provider:login`, and the
request time. Never put a bearer/session token, email address, or Telegram bot
token in the message.

Apply a short timeout with `AbortSignal.timeout`. Persist the request before
contacting Telegram. Decrypt the token only immediately before building the
request and do not retain it in module state. If the chat ID or bot token is
absent or the token cannot be decrypted, mark the notification
`not_configured`; if Telegram times out, returns non-2xx, or returns
`{ ok: false }`, mark it `failed` and log only a sanitized error. The user's
access request still succeeds. A notification outage must not lose the request
or encourage repeated submissions.

Add `POST /api/admin/requests/:id/resend-notification` for failed or
not-configured requests. It uses the current saved bot token and channel ID and
updates the notification state. Also add
`POST /api/admin/settings/telegram/test`, which sends a fixed test message
before the administrator relies on the configuration.

## 6. Add the admin API

Mount `createAdminRoutes(store)` at `/api/admin`, guarded once at the router
boundary by `createRequireAdmin`:

| Method and path | Behavior |
| --- | --- |
| `GET /api/admin/bootstrap` | Returns requests/users, chat ID, and `isBotTokenConfigured`; never the bot token or encrypted value. |
| `PATCH /api/admin/requests/:id` | Accepts `{ decision: "approve" | "reject" }` and performs the atomic decision. |
| `PATCH /api/admin/users/:id/status` | Accepts the explicit `pending`, `allowed`, or `blocked` state for whitelist maintenance. |
| `PATCH /api/admin/settings/telegram` | Validates and saves a chat ID plus an optional replacement token; explicit flags clear either value. |
| `POST /api/admin/settings/telegram/test` | Sends a fixed test notification. |
| `POST /api/admin/requests/:id/resend-notification` | Retries notification for one existing request. |

Validate UUIDs and JSON bodies with Zod. The Telegram settings request should
distinguish “token omitted, keep the current secret” from “remove the current
secret”; never use a blank password field to erase a saved token accidentally.
Validate the chat ID as a bounded numeric string and the token as a bounded,
non-whitespace secret without baking Telegram's current token layout too
strictly into the application. Render the token field as a password input with
password-manager-resistant labeling/autocomplete and clear its React state
immediately after every save/test attempt.
Return 404 for unknown user/request IDs rather than leaking distinctions.
Prevent an administrator from blocking their own currently authenticated
account, and never permit an API call to change admin membership. Sort pending
requests oldest first and other users by most recent request/update; the first
version does not need pagination for the expected private-server scale, but
keep list response types separate so a cursor can be added later.

## 7. Add the applicant UI

Extract a focused component under `app/components/account/` for the access
request state rather than expanding `AccountDialog.tsx` further. It should:

- replace the current generic “isn't enabled” paragraph for a `pending` user;
- show **Request access** when no request exists;
- disable the action and show progress while submitting;
- show a pending confirmation plus a refresh action after submission;
- show clear approved/rejected copy when the server reports a decision;
- use `ServerUnavailableNotice`/`friendlyMessage` conventions and keep local
  tracks usable throughout.

Keep boolean React state names under the established `is*` convention. The
request control must render only when `isServerEnabled`, the user is signed in,
and sync is unavailable.

Update the auth-store refresh function so `/api/me` results update both the
module singleton and the saved IndexedDB session. This is shared by the
pending-request refresh and by any future account-status refresh; do not
duplicate session mutation inside the component.

## 8. Add the `/admin` client route

Create `app/routes/admin.tsx`, register it explicitly in `app/routes.ts`, and
keep the route file limited to loader/action/page composition. The
`clientLoader` must initialize/revalidate auth and call
`GET /api/admin/bootstrap`. If the server is disabled, authentication cannot
be validated, or the API returns 404, throw a route `Response` with status 404
so the existing root error boundary renders **Page not found**. Do not render
an “unauthorized” or sign-in prompt at this URL.

This is a browser-only SPA on a static host: its JavaScript is public and route
concealment cannot hide implementation code. The meaningful guarantee is that
the route renders a 404 without a fresh successful admin API check and all
admin data/mutations are protected by the masked server middleware.

Create one component per file under `app/components/admin/`, likely:

- `AccessRequestList` and `AccessRequestRow` for pending/history actions;
- `UserAccessList` and `UserAccessRow` for current whitelist management;
- `TelegramSettingsCard` for write-only bot token, channel ID, save/remove,
  configured-state, and test controls;
- a small status badge component if request/user state is repeated.

Use `PageShell` and existing cards/buttons. Re-fetch bootstrap data after each
mutation instead of trying to reconcile several local lists optimistically;
disable only the row/card being mutated and show an inline error that does not
discard the loaded admin data. Add an Admin link in the account dialog only
when `auth.isAdmin` is true; hiding this link is convenience, not
authorization.

## 9. Automated test requirements and verification

Automated coverage is part of the feature, not a follow-up. Every server route,
authorization branch, state transition, store implementation, Telegram result,
and secret-handling path introduced here must have a focused test. Prefer
testing through `createApp(...).request(...)` with the memory store for HTTP
policy, plus direct SQLite integration tests for transactions, migrations, and
persistence. No automated test may contact Telegram or depend on developer
env files.

Server tests:

1. Environment parsing normalizes admin identities and rejects malformed or
   empty admin configuration.
2. Admin matching uses `provider:login`, is case-insensitive, checks all linked
   identities, and never relies on display name/handle.
3. Every admin endpoint returns the same 404 body/status for anonymous,
   expired-session, and signed-in non-admin callers.
4. An admin can bootstrap/list users, approve/reject requests, later re-enable
   a rejected user, and cannot demote their own admin account.
5. Request creation is signed-in-only, works for a non-allowed user, is
   idempotent under repeat/concurrent calls, and cannot be spammed after a
   decision.
6. Approval/rejection atomically updates both the request and `users.status`;
   `/api/me` and `requireAllowed` reflect the result immediately.
7. Telegram tests replace `globalThis.fetch` with a stub and cover success,
   missing configuration, timeout/non-2xx/API failure, resend, plain-text
   payloads, and the guarantee that notification failure does not fail the
   request.
8. Both memory and SQLite stores satisfy the new store contract, including
   account-deletion cleanup and persistence across SQLite reopen.
9. Telegram settings tests cover initial unconfigured state, setting/replacing
   both values, updating the chat ID without replacing the token, explicit
   removal, invalid token/chat IDs, and test-message behavior.
10. Secret tests prove AES-GCM round trips, random IVs produce different stored
    envelopes for the same token, tampering/wrong `SESSION_SECRET` fails
    closed, plaintext is absent from the database bytes, and bootstrap/export/
    error responses never contain plaintext or ciphertext.
11. SQLite tests force decision failures inside the transaction and verify
    neither request nor user status changes partially. Add concurrent request
    and concurrent decision tests to exercise uniqueness/idempotency.
12. Migration tests open a pre-feature database fixture, run startup migration
    twice, and verify existing users/tracks plus the newly created tables.

Client and E2E automated tests:

1. A pending account can submit once, sees pending state after reopening the
   dialog, and gains sync capability after approval plus refresh.
2. A rejected user sees rejection and no resubmit action; local/offline use is
   unaffected.
3. `/admin` renders the normal 404 for signed-out, non-admin, stale cached
   admin, disabled-server, and failed-validation cases.
4. The configured admin can load `/admin`, approve/reject, change an existing
   user's state, set/replace/remove a write-only token, save a negative
   Telegram chat ID, test it, and retry a failed notification.
5. The bot token never appears in API responses, browser storage, rendered
   markup, logs, or the account export.
6. The Telegram form preserves an existing token when only the chat ID changes,
   clears fields only through explicit actions, disables duplicate submits,
   and renders server validation/test failures without losing loaded data.
7. Applicant polling stops when the dialog closes or a terminal decision is
   reached and does not leak timers or trigger duplicate sync runs.

Run `bun run typecheck` and `bun run test` at the repository root, then
`cd server && bun run typecheck && bun test`. Run server tests with Bun's
coverage reporting as an additional gap check and add tests for meaningful
uncovered branches; do not chase generated/type-only lines. Add mandatory
Playwright coverage for the applicant and admin happy paths, masked 404s,
rejection, notification failure/retry, and write-only secret UI. Extend the e2e
server fixture so it can inject an admin identity and stub Telegram `fetch`
without contacting the real service. The only manual verification should be a
single final test message to the real private channel in staging/production.

## 10. Rollout and operational notes

1. Back up `DATA_DIR/fogofwalk.db` before deploying the schema migration.
2. Deploy with `ADMIN_LOGINS=github:mmmykhailo`.
3. Sign in as the admin, open `/admin`, configure/test the private Telegram
   bot token and channel ID, and confirm existing allowed users appear
   correctly.
4. Confirm existing allowed users appear correctly in the admin interface.
6. Document Telegram setup: add the bot to the private channel, grant it
   permission to post, and obtain the channel's numeric chat ID. Setting,
   rotating, or removing the token and changing the destination are all admin
   UI operations. Restrict the admin page accordingly and never paste the token
   into deployment variables or logs.

## Expected changed files

- `shared/api.ts`
- `server/src/env.ts`
- `server/src/schema/001_init.sql`
- `server/src/store/types.ts`
- `server/src/store/memory.ts`
- `server/src/store/sqlite-fs.ts`
- `server/src/auth/middleware.ts`
- `server/src/auth/routes.ts`
- `server/src/users.ts`
- `server/src/app.ts`
- `server/src/access/*` (new request routes/service)
- `server/src/admin/*` (new middleware/routes)
- `server/src/telegram.ts` (new native-fetch client)
- `server/.env.example`
- `server/README.md`
- `server/tests/*` (focused auth/request/admin/Telegram/store tests)
- `.github/workflows/deploy-server.yml`
- `app/lib/server/authStore.ts`
- `app/components/account/AccountDialog.tsx`
- `app/components/account/AccessRequestBlock.tsx` (new)
- `app/components/admin/*` (new)
- `app/routes/admin.tsx` (new)
- `app/routes.ts`
- focused client tests and mandatory applicant/admin Playwright coverage

No application code is changed in this planning pass.
