/**
 * Preloaded by `bun test` (see bunfig.toml). `src/env.ts` validates the
 * environment at import time and throws when it is incomplete, so these have
 * to be in place before any test file's imports are evaluated.
 *
 * These assignments are unconditional, and the provider credentials are
 * cleared outright. Bun auto-loads `server/.env`, so a developer who fills in
 * real GitHub credentials would otherwise flip the "no providers configured"
 * assertions. The test environment has to be hermetic, not merged with whatever
 * happens to be on the machine.
 */

process.env.PUBLIC_URL = "http://localhost:8787"
process.env.ALLOWED_ORIGINS = "http://localhost:5173"
process.env.ADMIN_LOGINS = "github:admin-user"
process.env.SESSION_SECRET = "test-secret-that-is-long-enough-0123456789"
process.env.STORE_DRIVER = "memory"
process.env.DATA_DIR = "./.test-data"

// Tests that want a configured provider set these themselves.
delete process.env.GITHUB_CLIENT_ID
delete process.env.GITHUB_CLIENT_SECRET
