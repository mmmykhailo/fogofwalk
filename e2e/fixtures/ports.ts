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
 * Local test-user names. Each test claims one by index, which is what gives
 * per-test isolation: every store method is scoped by user id, so two tests
 * cannot see each other's activities.
 */
export const LOGINS_PER_WORKER = 64
const MAX_WORKERS = 16

export const LOCAL_LOGIN_POOL = Array.from(
  { length: LOGINS_PER_WORKER * MAX_WORKERS },
  (_, i) => `e2e-${i}`
)

/** The dedicated local administrator that approves test access requests. */
export const ADMIN_LOGIN = "e2e-admin"

/** Not in the pool — remains pending for the access-gating auth test. */
export const UNLISTED_LOGIN = "e2e-stranger"
