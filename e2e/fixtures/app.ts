import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import {
  ADMIN_LOGIN,
  API_URL,
  LOCAL_LOGIN_POOL,
  LOGINS_PER_WORKER,
  WEB_URL,
} from "./ports"
import { AppPage } from "./app-page"

export { expect }

interface Fixtures {
  /** A login unique to this test — the isolation mechanism. See `ports.ts`. */
  login: string
  /** The page-object wrapper around the app under test. */
  app: AppPage
  /** Opens an independent browser context signed in as the specified user. */
  secondDevice: (login: string) => Promise<AppPage>
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

// Per worker process; combined with the worker index below.
let loginCursor = 0

async function localAdminToken(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/fake/start`, {
    params: { redirect: WEB_URL, name: ADMIN_LOGIN },
    maxRedirects: 0,
  })
  const location = response.headers()["location"]
  if (!location) throw new Error("local admin sign-in did not redirect")
  const handoff = new URL(location).searchParams.get("code")
  if (!handoff) throw new Error("local admin sign-in did not return a handoff")

  const exchange = await request.post(`${API_URL}/api/auth/exchange`, {
    data: { code: handoff },
  })
  const body = (await exchange.json()) as { token?: string }
  if (!body.token) throw new Error("local admin sign-in did not return a token")
  return body.token
}

async function approveLocalAccess(
  request: APIRequestContext,
  login: string
): Promise<void> {
  const token = await localAdminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const bootstrap = await request.get(`${API_URL}/api/admin/bootstrap`, {
    headers,
  })
  const body = (await bootstrap.json()) as {
    requests: { id: string; identity: string | null; status: string }[]
  }
  const accessRequest = body.requests.find(
    (item) => item.identity === `fake:${login}` && item.status === "pending"
  )
  if (!accessRequest) throw new Error(`no pending access request for ${login}`)

  const approval = await request.patch(
    `${API_URL}/api/admin/requests/${accessRequest.id}`,
    { headers, data: { decision: "approve" } }
  )
  if (!approval.ok()) {
    throw new Error(`failed to approve ${login}: ${approval.status()}`)
  }
}

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
      LOCAL_LOGIN_POOL[testInfo.workerIndex * LOGINS_PER_WORKER + offset]
    )
  },

  app: async ({ page, context, login, request }, use) => {
    await stubMapTiles(context)
    await use(
      new AppPage(page, login, (name) => approveLocalAccess(request, name))
    )
  },

  secondDevice: async ({ browser }, use) => {
    const opened: BrowserContext[] = []
    await use(async (login) => {
      const context = await browser.newContext({ baseURL: WEB_URL })
      opened.push(context)
      await stubMapTiles(context)
      return new AppPage(await context.newPage(), login)
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
