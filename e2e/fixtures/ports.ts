/**
 * Fixed ports for the test rig.
 *
 * Fixed rather than ephemeral because the client dev server bakes `VITE_API_URL`
 * in at boot and Playwright's `webServer` starts before any per-worker fixture
 * could hand it a port. Deliberately far from the app's defaults (8787 / 5173)
 * so a running `bun run dev` never collides with a test run.
 */
export const API_PORT = 8788
export const IDP_PORT = 8789
export const WEB_PORT = 5183
/** The server-less project — same build, `VITE_API_URL` unset. */
export const WEB_PORT_SERVERLESS = 5184

export const API_URL = `http://localhost:${API_PORT}`
export const IDP_URL = `http://localhost:${IDP_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const WEB_URL_SERVERLESS = `http://localhost:${WEB_PORT_SERVERLESS}`

/**
 * Test administrator logins. Each test claims one by
 * index, which is what gives per-test isolation: every store method is scoped by
 * user id, so two tests using different logins cannot see each other's activities.
 */
export const LOGINS_PER_WORKER = 64
const MAX_WORKERS = 16

export const ADMIN_LOGIN_POOL = Array.from(
  { length: LOGINS_PER_WORKER * MAX_WORKERS },
  (_, i) => `e2e-${i}`
)

/** Not in the pool — lands as `pending`, which is the access-request path. */
export const UNLISTED_LOGIN = "e2e-stranger"
