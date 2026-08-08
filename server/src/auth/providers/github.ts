/**
 * GitHub OAuth, via `arctic` v3 (MIT).
 *
 * arctic v3's GitHub client is `new GitHub(clientId, clientSecret, redirectURI)`
 * with `createAuthorizationURL(state, scopes)` and
 * `validateAuthorizationCode(code)` — GitHub does not implement PKCE, so the
 * verifier this module receives is deliberately unused.
 */

import { GitHub } from "arctic"

import type { OAuthProfile, OAuthProvider } from "./types"

const USER_AGENT = "fogofwalk-server"

interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
  email: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

export function createGitHubProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string
): OAuthProvider {
  const client = new GitHub(clientId, clientSecret, redirectUri)

  return {
    id: "github",
    label: "GitHub",

    createAuthUrl(state: string): URL {
      // `read:user` is enough for id/login/name/avatar; `user:email` only adds
      // the private primary address, and the flow tolerates it being absent.
      return client.createAuthorizationURL(state, ["read:user", "user:email"])
    },

    async exchange(code: string): Promise<OAuthProfile> {
      const tokens = await client.validateAuthorizationCode(code)
      const accessToken = tokens.accessToken()

      const user = await githubApi<GitHubUser>("/user", accessToken)

      let email = user.email
      if (!email) {
        // Best effort: the token may not carry `user:email`, and a user can
        // have no verified address at all. Never fail sign-in over this.
        try {
          const emails = await githubApi<GitHubEmail[]>(
            "/user/emails",
            accessToken
          )
          email =
            emails.find((entry) => entry.primary && entry.verified)?.email ??
            emails.find((entry) => entry.verified)?.email ??
            null
        } catch {
          email = null
        }
      }

      return {
        providerUserId: String(user.id),
        login: user.login,
        displayName: user.name || user.login,
        avatarUrl: user.avatar_url,
        email,
      }
    },
  }
}
