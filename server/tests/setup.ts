/**
 * Preloaded by `bun test` (see bunfig.toml). `src/env.ts` validates the
 * environment at import time and throws when it is incomplete, so these have
 * to be in place before any test file's imports are evaluated.
 */

process.env.PUBLIC_URL ??= "http://localhost:8787"
process.env.ALLOWED_ORIGINS ??= "http://localhost:5173"
process.env.ALLOWED_LOGINS ??= "github:allowed-user"
process.env.SESSION_SECRET ??= "test-secret-that-is-long-enough-0123456789"
process.env.STORE_DRIVER ??= "memory"
