/**
 * A stand-in for GitHub's OAuth token endpoint and user API.
 *
 * The server under test talks to this instead of github.com — not because the
 * URLs were reconfigured (arctic hardcodes them) but because `stub-github.ts`
 * rewrites the two outbound calls. Nothing in `server/src` knows this exists.
 *
 * The identity is carried in the OAuth `code`, which Playwright's route stub
 * mints as `user:<login>`; the access token then carries it forward as
 * `token:<login>`. That keeps the IdP stateless, so tests never race over it.
 */

import { IDP_PORT } from "./ports"

const LOGIN_FROM_CODE = /^user:(?<login>[\w-]+)$/
const LOGIN_FROM_TOKEN = /^token:(?<login>[\w-]+)$/

function loginFrom(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.groups?.login ?? null
}

export function createFakeIdp(port: number = IDP_PORT) {
  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url)

      // Stands in for https://github.com/login/oauth/access_token
      if (url.pathname === "/login/oauth/access_token") {
        const body = new URLSearchParams(await request.text())
        const login = loginFrom(body.get("code") ?? "", LOGIN_FROM_CODE)
        if (!login) {
          return Response.json({ error: "bad_verification_code" }, { status: 400 })
        }
        return Response.json({
          access_token: `token:${login}`,
          token_type: "bearer",
          scope: "read:user,user:email",
        })
      }

      // Stands in for https://api.github.com/user
      if (url.pathname === "/user") {
        const auth = request.headers.get("authorization") ?? ""
        const login = loginFrom(auth.replace(/^Bearer\s+/i, ""), LOGIN_FROM_TOKEN)
        if (!login) return Response.json({ message: "Bad credentials" }, { status: 401 })
        return Response.json({
          id: hashToNumber(login),
          login,
          name: `E2E ${login}`,
          avatar_url: null,
          email: `${login}@example.test`,
        })
      }

      if (url.pathname === "/health") return Response.json({ ok: true })
      return new Response("not found", { status: 404 })
    },
  })
}

/** Stable numeric provider id per login, so re-signing in is the same user. */
function hashToNumber(login: string): number {
  let hash = 0
  for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

// Runnable directly: `bun fixtures/fake-idp.ts`
if (import.meta.main) {
  const server = createFakeIdp()
  console.log(`[fake-idp] listening on ${server.url}`)
}
