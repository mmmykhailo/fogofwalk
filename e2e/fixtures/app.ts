import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import { ADMIN_LOGIN_POOL, API_URL, LOGINS_PER_WORKER, WEB_URL } from "./ports"
import { AppPage } from "./app-page"

export { expect }

interface Fixtures {
  /** A login unique to this test — the isolation mechanism. See `ports.ts`. */
  login: string
  /** The page-object wrapper around the app under test. */
  app: AppPage
  /** Opens an independent browser context signed in as the *same* user. */
  secondDevice: (login?: string) => Promise<AppPage>
  /** Authenticated API client, for asserting state the UI cannot show. */
  serverState: (page: Page) => Promise<ServerState>
}

export interface ServerState {
  activities: { contentHash: string; name: string }[]
  tombstones: string[]
}

/**
 * Blocks the app's outbound map traffic and fulfils the one request it cannot
 * live without.
 *
 * `mapReady` — and therefore every control in the app — flips only on
 * MapLibre's `load` event, which needs the style JSON. Aborting it hangs the
 * suite; serving a minimal valid style makes the map load instantly and offline.
 */
const OFFLINE_STYLE = {
  version: 8,
  name: "e2e-offline",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0a1e" } },
  ],
}

async function stubMapTiles(context: BrowserContext) {
  // One handler per host rather than a specific route plus a catch-all:
  // Playwright resolves routes in reverse registration order, so a later
  // catch-all silently wins over an earlier specific route — which aborted the
  // style JSON and hung `mapReady` forever.
  await context.route("https://tiles.openfreemap.org/**", (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OFFLINE_STYLE),
      })
    }
    return route.abort()
  })

  for (const host of [
    "https://server.arcgisonline.com/**",
    "https://s3.amazonaws.com/**",
  ]) {
    await context.route(host, (route) => route.abort())
  }
}

/**
 * Intercepts the browser half of the OAuth dance.
 *
 * The server half (token exchange + user lookup) is redirected by the
 * `stub-github.ts` preload; this is the half Playwright can see. The `code` we
 * hand back carries the identity, and `state` is echoed from the real request
 * so the server's signed state cookie still validates.
 */
/**
 * Replaces the provider leg of the OAuth dance.
 *
 * It intercepts `/api/auth/github/start` rather than the github.com navigation,
 * because **Playwright cannot route a request reached through a redirect** —
 * only the request that begins the chain. Our server answers `/start` with a
 * 302 to github.com, so that hop is untouchable and the browser sails through
 * to the real site.
 *
 * So: let the real `/start` run via `route.fetch` (it mints the state and sets
 * the signed state cookie), then hand the browser the same response with the
 * `Location` swapped for the callback plus a code the fake IdP understands. The
 * cookie rides along on the passed-through response, so the callback's state
 * validation is exercised for real rather than bypassed.
 */
async function stubOAuthRedirect(context: BrowserContext, login: string) {
  await context.route(/\/api\/auth\/[^/]+\/start/, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 })
    const location = response.headers()["location"]
    if (!location) {
      // Not a redirect — an error the spec should see verbatim (bad origin, etc).
      return route.fulfill({ response })
    }

    const target = new URL(`${API_URL}/api/auth/github/callback`)
    target.searchParams.set("code", `user:${login}`)
    target.searchParams.set(
      "state",
      new URL(location).searchParams.get("state") ?? ""
    )

    return route.fulfill({
      response,
      status: 302,
      headers: { ...response.headers(), location: target.toString() },
    })
  })

  // Nothing in a test should ever reach the real site.
  await context.route(
    /^https:\/\/(github|api\.github|github\.githubassets)\.com\//,
    (route) => route.abort()
  )
}

// Per worker process; combined with the worker index below.
let loginCursor = 0

export const test = base.extend<Fixtures>({
  login: async ({}, use, testInfo) => {
    // Each worker owns a disjoint slice of the pool. Multiplying the cursor by
    // the worker index (the previous attempt) overlaps — worker 0 takes 0,1,2…
    // and worker 1 takes 0,2,4… — so two tests shared a user and each other's
    // activities, which surfaced as unexplained duplicate-import dialogs.
    const offset = loginCursor++
    if (offset >= LOGINS_PER_WORKER) {
      throw new Error(
        `worker ${testInfo.workerIndex} ran more than ${LOGINS_PER_WORKER} tests; widen the login pool`
      )
    }
    await use(
      ADMIN_LOGIN_POOL[testInfo.workerIndex * LOGINS_PER_WORKER + offset]
    )
  },

  app: async ({ page, context, login }, use) => {
    await stubMapTiles(context)
    await stubOAuthRedirect(context, login)
    await use(new AppPage(page, login))
  },

  secondDevice: async ({ browser, login }, use) => {
    const opened: BrowserContext[] = []
    await use(async (asLogin = login) => {
      const context = await browser.newContext({ baseURL: WEB_URL })
      opened.push(context)
      await stubMapTiles(context)
      await stubOAuthRedirect(context, asLogin)
      return new AppPage(await context.newPage(), asLogin)
    })
    for (const context of opened) await context.close()
  },

  serverState: async ({ request }, use) => {
    await use(async (page: Page) => {
      const token = await readSessionToken(page)
      const res = await request.get(
        `${API_URL}/api/activities/manifest?since=0`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const body = (await res.json()) as {
        activities: { contentHash: string; name: string }[]
        deletions: { contentHash: string }[]
      }
      return {
        activities: body.activities,
        tombstones: body.deletions.map((d) => d.contentHash),
      }
    })
  },
})

/** Reads the bearer token straight out of the app's IndexedDB `prefs` store. */
export async function readSessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("fogofwalk")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise<string | null>((resolve) => {
      const tx = db.transaction("prefs", "readonly")
      const get = tx.objectStore("prefs").get("session")
      get.onsuccess = () => resolve(get.result?.value?.token ?? null)
      get.onerror = () => resolve(null)
    })
  })
  if (!token)
    throw new Error("no session token in IndexedDB — is the page signed in?")
  return token
}
