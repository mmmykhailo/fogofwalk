/**
 * Bun `--preload` module: redirects the server's two outbound GitHub calls to
 * the local fake IdP.
 *
 * The OAuth token exchange and user lookup run server-side, where Playwright's
 * `page.route` cannot reach. Patching `fetch` in the *test harness* keeps
 * `server/src` free of any test-only configuration — the callback handler,
 * state-cookie validation, administrator promotion, session minting and
 * handoff code all run for real.
 *
 * Loaded only by the E2E rig: `bun --preload <this> src/index.ts`.
 */

const IDP_URL = Bun.env.E2E_IDP_URL
if (!IDP_URL) {
  throw new Error("stub-github preload requires E2E_IDP_URL")
}

const REWRITES: Array<[prefix: string, target: string]> = [
  [
    "https://github.com/login/oauth/access_token",
    `${IDP_URL}/login/oauth/access_token`,
  ],
  ["https://api.github.com/user", `${IDP_URL}/user`],
]

const realFetch = globalThis.fetch

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  for (const [prefix, target] of REWRITES) {
    if (url.startsWith(prefix)) {
      const rewritten = target + url.slice(prefix.length)
      // Requests carry headers and a body, so rebuild them with the rewritten
      // URL rather than dropping either while forwarding to the fake IdP.
      if (input instanceof Request) {
        return realFetch(new Request(rewritten, input), init)
      }
      return realFetch(rewritten, init)
    }
  }

  return realFetch(input as RequestInfo, init)
}) as typeof fetch

console.log(`[stub-github] github.com -> ${IDP_URL}`)
